import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import type { AuditLog } from '../src/audit/entities/audit-log.entity.js';
import type { BlockedIp } from '../src/firewall/entities/blocked-ip.entity.js';
import { FirewallService } from '../src/firewall/firewall.service.js';
import { NotificationSender } from '../src/notifications/channels/notification-sender.js';
import { NotificationChannel } from '../src/notifications/entities/notification-channel.enum.js';
import { UserRole } from '../src/users/entities/user-role.enum.js';
import { UsersService } from '../src/users/users.service.js';

/**
 * Audit trail, firewall and health against a real Postgres and Redis:
 *
 *   DATABASE_NAME=security_alerts_test npm run migration:run
 *   DATABASE_NAME=security_alerts_test npm run test:e2e
 *
 * Empties only its own tables (audit_logs, blocked_ips) and uses unique
 * emails, rule names and IPs, so it doesn't disturb the other suites.
 */
describe('Audit and firewall (e2e)', () => {
  const run = randomUUID().slice(0, 8);
  let app: INestApplication<App>;
  let db: DataSource;
  let firewall: FirewallService;
  let adminToken: string;
  let analystToken: string;
  let adminId: string;
  let analystId: string;
  let apiKey: string;
  let sourceId: string;

  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${adminToken}`);
  const asAnalyst = (req: request.Test) =>
    req.set('Authorization', `Bearer ${analystToken}`);

  /** Audit rows are written after the response is sent, so poll for them. */
  const waitFor = async <T>(
    read: () => Promise<T | null | undefined>,
    timeoutMs = 10_000,
  ): Promise<T> => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const value = await read();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timed out after ${timeoutMs}ms`);
  };
  const auditRow = (where: string, params: unknown[]) =>
    waitFor(async () => {
      const rows = (await db.query(
        `SELECT * FROM "audit_logs" WHERE ${where} ORDER BY "createdAt" DESC`,
        params,
      )) as AuditLog[];
      return rows[0];
    });

  beforeAll(async () => {
    const dbName = process.env.DATABASE_NAME ?? '';
    if (!dbName.endsWith('_test')) {
      throw new Error(
        `Refusing to run e2e tests against "${dbName}": set DATABASE_NAME to a database ending in _test`,
      );
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // No real Slack/email calls from the escalation in the auto-block test.
      .overrideProvider(NotificationSender)
      .useValue({
        enabledChannels: () => [NotificationChannel.SLACK],
        send: async () => undefined,
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(DataSource);
    firewall = app.get(FirewallService);

    await db.query('TRUNCATE "audit_logs", "blocked_ips"');
    await firewall.refresh();

    const users = app.get(UsersService);
    const jwt = app.get(JwtService);
    const make = async (role: UserRole) => {
      const user = await users.create({
        email: `${role}-${run}@audit.test`,
        password: 'long-enough-password',
        role,
      });
      return {
        id: user.id,
        token: await jwt.signAsync({
          sub: user.id,
          email: user.email,
          role: user.role,
        }),
      };
    };
    ({ id: adminId, token: adminToken } = await make(UserRole.ADMIN));
    ({ id: analystId, token: analystToken } = await make(UserRole.ANALYST));
  });

  afterAll(async () => {
    await db?.query('TRUNCATE "blocked_ips"');
    await app?.close();
  });

  describe('audit trail', () => {
    it('records an admin creating a source, with the new id and no API key', async () => {
      const res = await asAdmin(http().post('/sources'))
        .send({ name: `audit-src-${run}` })
        .expect(201);
      apiKey = res.body.apiKey;
      sourceId = res.body.id;

      const row = await auditRow(
        `"action" = 'created_source' AND "targetId" = $1`,
        [sourceId],
      );
      expect(row).toMatchObject({
        userId: adminId,
        actorRole: 'admin',
        outcome: 'success',
        targetType: 'source',
        method: 'POST',
        path: '/sources',
        statusCode: 201,
        metadata: { name: `audit-src-${run}` },
      });
      expect(JSON.stringify(row)).not.toContain(apiKey);
    });

    it('records who acknowledged an alert', async () => {
      const alert = await http()
        .post('/alerts')
        .set('x-api-key', apiKey)
        .send({
          title: 'port scan',
          severity: 'medium',
          type: `port_scan_${run}`,
          ipAddress: '192.0.2.10',
        })
        .expect(201);

      await asAnalyst(http().patch(`/alerts/${alert.body.id}/status`))
        .send({ status: 'acknowledged' })
        .expect(200);

      const row = await auditRow(
        `"action" = 'acknowledged_alert' AND "targetId" = $1`,
        [alert.body.id],
      );
      expect(row).toMatchObject({
        userId: analystId,
        actorRole: 'analyst',
        outcome: 'success',
        metadata: { status: 'acknowledged' },
      });
    });

    it('records refused privileged actions as denied', async () => {
      const alert = await http()
        .post('/alerts')
        .set('x-api-key', apiKey)
        .send({ title: 'x', severity: 'low', type: `noise_${run}` })
        .expect(201);
      await asAnalyst(http().delete(`/alerts/${alert.body.id}`)).expect(403);

      const row = await auditRow(
        `"action" = 'deleted_alert' AND "targetId" = $1`,
        [alert.body.id],
      );
      expect(row).toMatchObject({
        userId: analystId,
        outcome: 'denied',
        statusCode: 403,
      });
    });

    it('lets only admins read it, and records an analyst trying as access_denied', async () => {
      await asAnalyst(http().get('/audit')).expect(403);
      const row = await auditRow(
        `"action" = 'access_denied' AND "userId" = $1 AND "path" = '/audit'`,
        [analystId],
      );
      expect(row.outcome).toBe('denied');
    });

    it('filters and paginates GET /audit, newest first', async () => {
      const res = await asAdmin(
        http()
          .get('/audit')
          .query({ userId: analystId, outcome: 'denied', limit: 1 }),
      ).expect(200);
      expect(res.body).toMatchObject({ total: 2, page: 1, limit: 1 });
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].action).toBe('access_denied');

      await asAdmin(http().get('/audit').query({ outcome: 'maybe' })).expect(
        400,
      );
      await asAdmin(http().get('/audit').query({ limit: 500 })).expect(400);
    });

    it('does not record ordinary reads or anonymous probing', async () => {
      await asAnalyst(http().get('/alerts')).expect(200);
      await http().delete(`/alerts/${randomUUID()}`).expect(404);
      await new Promise((r) => setTimeout(r, 300));

      const [{ count }] = (await db.query(
        `SELECT COUNT(*)::int AS count FROM "audit_logs" WHERE "path" = '/alerts' OR "userId" IS NULL AND "actorRole" <> 'system'`,
      )) as [{ count: number }];
      expect(count).toBe(0);
    });

    it('is append-only at the database level', async () => {
      await expect(
        db.query(`UPDATE "audit_logs" SET "action" = 'nothing'`),
      ).rejects.toThrow('append-only');
      await expect(db.query(`DELETE FROM "audit_logs"`)).rejects.toThrow(
        'append-only',
      );
    });
  });

  describe('firewall', () => {
    const ip = '198.51.100.23';
    let blockId: string;

    it('lets an admin block an IP, and audits it', async () => {
      const res = await asAdmin(http().post('/firewall/blocked-ips'))
        .send({
          ip,
          reason: 'Credential stuffing seen at the bank',
          expiresInMinutes: 30,
        })
        .expect(201);
      blockId = res.body.id;
      expect(res.body).toMatchObject({
        network: `${ip}/32`,
        origin: 'manual',
        createdBy: adminId,
      });

      const row = await auditRow(
        `"action" = 'blocked_ip' AND "targetId" = $1`,
        [blockId],
      );
      expect(row).toMatchObject({
        outcome: 'success',
        metadata: { ip, expiresInMinutes: 30 },
      });
    });

    it('answers integrated apps through POST /firewall/check with their API key', async () => {
      const blocked = await http()
        .post('/firewall/check')
        .set('x-api-key', apiKey)
        .send({ ip })
        .expect(200);
      expect(blocked.body).toMatchObject({
        ip,
        blocked: true,
        reason: 'Credential stuffing seen at the bank',
      });

      const fine = await http()
        .post('/firewall/check')
        .set('x-api-key', apiKey)
        .send({ ip: '198.51.100.24' })
        .expect(200);
      expect(fine.body).toMatchObject({ blocked: false, reason: null });

      await http().post('/firewall/check').send({ ip }).expect(401);
      await http()
        .post('/firewall/check')
        .set('x-api-key', apiKey)
        .send({ ip: 'not-an-ip' })
        .expect(400);
    });

    it('lists active blocks for admins only', async () => {
      const res = await asAdmin(http().get('/firewall/blocked-ips')).expect(
        200,
      );
      expect(res.body.map((b: BlockedIp) => b.id)).toContain(blockId);
      await asAnalyst(http().get('/firewall/blocked-ips')).expect(403);
      await asAnalyst(http().post('/firewall/blocked-ips'))
        .send({ ip: '198.51.100.99' })
        .expect(403);
    });

    it('rejects bad input, duplicates and blocks that would lock the admin out', async () => {
      await asAdmin(http().post('/firewall/blocked-ips'))
        .send({ ip: 'office' })
        .expect(400);
      await asAdmin(http().post('/firewall/blocked-ips'))
        .send({ ip: '0.0.0.0/0' })
        .expect(400);
      await asAdmin(http().post('/firewall/blocked-ips'))
        .send({ ip })
        .expect(409);
      // supertest connects from localhost.
      const own = await asAdmin(http().post('/firewall/blocked-ips'))
        .send({ ip: '127.0.0.0/8' })
        .expect(400);
      expect(own.body.message).toContain('your own IP');
    });

    it('unblocks', async () => {
      await asAdmin(http().delete(`/firewall/blocked-ips/${blockId}`)).expect(
        204,
      );
      await asAdmin(http().delete(`/firewall/blocked-ips/${blockId}`)).expect(
        404,
      );
      const res = await http()
        .post('/firewall/check')
        .set('x-api-key', apiKey)
        .send({ ip })
        .expect(200);
      expect(res.body.blocked).toBe(false);
    });

    it('turns a blocked IP away from every route, before authentication', async () => {
      // Inserted directly: the API itself refuses to block the caller's own IP.
      const [{ id }] = (await db.query(
        `INSERT INTO "blocked_ips" ("network", "reason", "origin") VALUES ('127.0.0.1/32', 'e2e', 'manual') RETURNING "id"`,
      )) as [{ id: string }];
      await firewall.refresh();
      try {
        const res = await http().get('/').expect(403);
        expect(res.body.message).toBe('Access denied');
        await asAdmin(http().get('/audit')).expect(403);
        await http()
          .post('/auth/login')
          .send({ email: 'x@example.com', password: 'whatever-long' })
          .expect(403);
      } finally {
        await db.query(`DELETE FROM "blocked_ips" WHERE "id" = $1`, [id]);
        await firewall.refresh();
      }
      await http().get('/').expect(200);
    });

    it('auto-blocks the IP of a high escalation and records it as a system action', async () => {
      const attacker = '192.0.2.77';
      const type = `failed_login_${run}`;
      await asAdmin(http().post('/rules'))
        .send({
          name: `auto-block ${run}`,
          type,
          threshold: 3,
          windowSeconds: 60,
          severity: 'high',
        })
        .expect(201);

      for (let i = 0; i < 3; i++) {
        await http()
          .post('/alerts')
          .set('x-api-key', apiKey)
          .send({
            title: `failed login ${i}`,
            severity: 'low',
            type,
            ipAddress: attacker,
          })
          .expect(201);
      }

      const block = await waitFor(async () => {
        const rows = (await db.query(
          `SELECT * FROM "blocked_ips" WHERE "network" = $1`,
          [`${attacker}/32`],
        )) as BlockedIp[];
        return rows[0];
      });
      expect(block).toMatchObject({ origin: 'auto', createdBy: null });
      expect(block.alertId).toEqual(expect.any(String));
      expect(new Date(block.expiresAt!).getTime()).toBeGreaterThan(Date.now());

      const check = await http()
        .post('/firewall/check')
        .set('x-api-key', apiKey)
        .send({ ip: attacker })
        .expect(200);
      expect(check.body.blocked).toBe(true);

      const row = await auditRow(
        `"action" = 'auto_blocked_ip' AND "targetId" = $1`,
        [block.id],
      );
      expect(row).toMatchObject({
        userId: null,
        actorRole: 'system',
        outcome: 'success',
        ip: attacker,
      });
      expect(row.metadata).toMatchObject({
        alertId: block.alertId,
        ruleName: `auto-block ${run}`,
      });
    });

    it('does not auto-block from low raw alerts alone', async () => {
      await http()
        .post('/alerts')
        .set('x-api-key', apiKey)
        .send({
          title: 'one-off',
          severity: 'critical',
          type: `one_off_${run}`,
          ipAddress: '192.0.2.88',
        })
        .expect(201);
      await new Promise((r) => setTimeout(r, 500));
      const res = await http()
        .post('/firewall/check')
        .set('x-api-key', apiKey)
        .send({ ip: '192.0.2.88' })
        .expect(200);
      expect(res.body.blocked).toBe(false);
    });
  });

  describe('health', () => {
    it('reports Postgres and Redis as up, without a token', async () => {
      const res = await http().get('/health').expect(200);
      expect(res.body).toEqual({
        status: 'ok',
        checks: { database: 'up', redis: 'up' },
      });
    });
  });
});
