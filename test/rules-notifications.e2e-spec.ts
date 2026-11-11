import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import type { Alert } from '../src/alerts/entities/alert.entity.js';
import { NotificationSender } from '../src/notifications/channels/notification-sender.js';
import { NotificationChannel } from '../src/notifications/entities/notification-channel.enum.js';
import { NotificationStatus } from '../src/notifications/entities/notification-status.enum.js';
import { Notification } from '../src/notifications/entities/notification.entity.js';
import { UserRole } from '../src/users/entities/user-role.enum.js';
import { UsersService } from '../src/users/users.service.js';

/**
 * Rules -> rule engine -> BullMQ worker -> Notification, against a real
 * Postgres and Redis. The only fake is the outbound sender (no real Slack
 * call). Uses the same migrated *_test database as alerts.e2e-spec.ts:
 *
 *   DATABASE_NAME=security_alerts_test npm run test:e2e
 *
 * It only creates and deletes its own rows (unique names), so it does not
 * wipe data other suites rely on. Don't run it while a dev server is up: both
 * would consume the same "notifications" queue in Redis.
 */
describe('Rules and notifications (e2e)', () => {
  const run = randomUUID().slice(0, 8);
  let app: INestApplication<App>;
  let db: DataSource;
  let adminToken: string;
  let analystToken: string;
  let apiKey: string;
  const userIds: string[] = [];
  let sourceId: string;

  /** Alert types whose delivery the fake sender fails. */
  const failingTypes = new Set<string>();
  const sent: string[] = [];
  const fakeSender = {
    enabledChannels: () => [NotificationChannel.SLACK],
    send: async (_channel: NotificationChannel, alert: Alert) => {
      if (failingTypes.has(alert.type)) throw new Error('webhook unreachable');
      sent.push(alert.id);
    },
  };

  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken}`);
  const asAnalyst = (req: request.Test) => req.set('Authorization', `Bearer ${analystToken}`);
  const ingest = (type: string, ip: string) =>
    http()
      .post('/alerts')
      .set('x-api-key', apiKey)
      .send({ title: `${type} from ${ip}`, severity: 'low', type, ipAddress: ip })
      .expect(201);

  /** Polls until `read` returns a value, for the async event and worker steps. */
  const waitFor = async <T>(read: () => Promise<T | null | undefined>, timeoutMs = 10_000): Promise<T> => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const value = await read();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Timed out after ${timeoutMs}ms`);
  };

  const escalationFor = (ruleId: string) =>
    db.query(`SELECT * FROM "alerts" WHERE "payload"->>'ruleId' = $1`, [ruleId]) as Promise<Alert[]>;

  beforeAll(async () => {
    const dbName = process.env.DATABASE_NAME ?? '';
    if (!dbName.endsWith('_test')) {
      throw new Error(`Refusing to run e2e tests against "${dbName}": set DATABASE_NAME to a database ending in _test`);
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationSender)
      .useValue(fakeSender)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    db = app.get(DataSource);

    const users = app.get(UsersService);
    const jwt = app.get(JwtService);
    const tokenFor = async (role: UserRole) => {
      const user = await users.create({ email: `${role}-${run}@example.com`, password: 'long-enough-password', role });
      userIds.push(user.id);
      return jwt.signAsync({ sub: user.id, email: user.email, role: user.role });
    };
    adminToken = await tokenFor(UserRole.ADMIN);
    analystToken = await tokenFor(UserRole.ANALYST);

    const source = await asAdmin(http().post('/sources')).send({ name: `rules-e2e-${run}` }).expect(201);
    apiKey = source.body.apiKey;
    sourceId = source.body.id;
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      // Notifications go with their alerts (ON DELETE CASCADE).
      if (sourceId) await db.query(`DELETE FROM "alerts" WHERE "sourceId" = $1`, [sourceId]);
      if (sourceId) await db.query(`DELETE FROM "sources" WHERE "id" = $1`, [sourceId]);
      await db.query(`DELETE FROM "alert_rules" WHERE "name" LIKE $1`, [`%${run}%`]);
      if (userIds.length) await db.query(`DELETE FROM "users" WHERE "id" = ANY($1)`, [userIds]);
    }
    await app?.close();
  });

  describe('/rules CRUD', () => {
    let ruleId: string;

    it('is admin only', async () => {
      await asAnalyst(http().get('/rules')).expect(403);
      await asAnalyst(http().post('/rules')).send({}).expect(403);
      // JwtAuthGuard hides routes from unauthenticated callers.
      await http().get('/rules').expect(404);
    });

    it('validates the body', async () => {
      const res = await asAdmin(http().post('/rules'))
        .send({ name: 'x', type: 'Failed Login', threshold: 0, windowSeconds: 999999, severity: 'urgent' })
        .expect(400);
      const messages = (res.body.message as string[]).join(' | ');
      expect(messages).toMatch(/snake_case/);
      expect(messages).toMatch(/threshold/);
      expect(messages).toMatch(/windowSeconds/);
      expect(messages).toMatch(/severity/);
    });

    it('creates, lists, reads and updates a rule', async () => {
      const created = await asAdmin(http().post('/rules'))
        .send({ name: `crud ${run}`, type: 'port_scan', threshold: 10, windowSeconds: 60, severity: 'medium' })
        .expect(201);
      ruleId = created.body.id;
      expect(created.body).toMatchObject({ type: 'port_scan', isEnabled: true });

      const list = await asAdmin(http().get('/rules')).expect(200);
      expect(list.body.map((r: { id: string }) => r.id)).toContain(ruleId);

      await asAdmin(http().get(`/rules/${ruleId}`)).expect(200);
      await asAdmin(http().get(`/rules/${randomUUID()}`)).expect(404);

      const updated = await asAdmin(http().patch(`/rules/${ruleId}`)).send({ isEnabled: false }).expect(200);
      expect(updated.body).toMatchObject({ isEnabled: false, threshold: 10, name: `crud ${run}` });
    });
  });

  describe('rule engine and notification worker', () => {
    it('escalates once at the threshold and delivers the notification', async () => {
      const type = `e2e_ok_${run}`;
      const ip = '198.51.100.31';
      const rule = await asAdmin(http().post('/rules'))
        .send({ name: `ok ${run}`, type, threshold: 3, windowSeconds: 60, severity: 'high' })
        .expect(201);

      await ingest(type, ip);
      await ingest(type, ip);
      await new Promise((r) => setTimeout(r, 300));
      expect(await escalationFor(rule.body.id)).toHaveLength(0);

      await ingest(type, ip);
      const [escalated] = await waitFor(async () => {
        const rows = await escalationFor(rule.body.id);
        return rows.length ? rows : null;
      });
      expect(escalated).toMatchObject({ severity: 'high', type, ipAddress: ip, sourceId });
      expect(escalated.payload).toMatchObject({ matchedCount: 3, threshold: 3 });

      const notification = await waitFor(() =>
        db.getRepository(Notification).findOne({ where: { alertId: escalated.id, status: NotificationStatus.SENT } }),
      );
      expect(notification).toMatchObject({ channel: 'slack', attempts: 1, lastError: null });
      expect(notification.sentAt).toBeInstanceOf(Date);
      expect(sent).toContain(escalated.id);

      // More events inside the window do not raise a second escalation.
      await ingest(type, ip);
      await new Promise((r) => setTimeout(r, 500));
      expect(await escalationFor(rule.body.id)).toHaveLength(1);
    }, 20_000);

    it('ignores disabled rules', async () => {
      const type = `e2e_off_${run}`;
      const rule = await asAdmin(http().post('/rules'))
        .send({ name: `off ${run}`, type, threshold: 1, windowSeconds: 60, severity: 'high', isEnabled: false })
        .expect(201);

      await ingest(type, '198.51.100.32');
      await new Promise((r) => setTimeout(r, 500));
      expect(await escalationFor(rule.body.id)).toHaveLength(0);
    });

    it('retries a failing delivery and marks it failed after the last attempt', async () => {
      const type = `e2e_fail_${run}`;
      failingTypes.add(type);
      const rule = await asAdmin(http().post('/rules'))
        .send({ name: `fail ${run}`, type, threshold: 1, windowSeconds: 60, severity: 'critical' })
        .expect(201);

      await ingest(type, '198.51.100.33');
      const [escalated] = await waitFor(async () => {
        const rows = await escalationFor(rule.body.id);
        return rows.length ? rows : null;
      });

      // 3 attempts with 5s then 10s backoff.
      const notification = await waitFor(
        () => db.getRepository(Notification).findOne({ where: { alertId: escalated.id, status: NotificationStatus.FAILED } }),
        30_000,
      ).catch(async (error: Error) => {
        const rows = await db.getRepository(Notification).find({ where: { alertId: escalated.id } });
        throw new Error(`${error.message}; notifications: ${JSON.stringify(rows)}`);
      });
      expect(notification).toMatchObject({ attempts: 3, lastError: 'webhook unreachable', sentAt: null });
    }, 40_000);
  });
});
