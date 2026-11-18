import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import type { AuditLog } from '../src/audit/entities/audit-log.entity.js';
import { Lockout } from '../src/auth/entities/lockout.entity.js';
import { LoginAttempt } from '../src/auth/entities/login-attempt.entity.js';
import { UserRole } from '../src/users/entities/user-role.enum.js';
import { UsersService } from '../src/users/users.service.js';

/**
 * The read-only /detection routes the dashboard uses. Rows are inserted
 * directly, because reaching rule thresholds over HTTP would trip the login
 * rate limit. Uses its own IPs and emails, and removes only its own rows.
 */
describe('Login detection insights (e2e)', () => {
  const run = randomUUID().slice(0, 8);
  const email = `target-${run}@detection.test`;
  const ip = '198.18.77.1';
  let app: INestApplication<App>;
  let db: DataSource;
  let adminToken: string;
  let analystToken: string;
  let activeLockId: string;
  let expiredLockId: string;

  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${adminToken}`);
  const asAnalyst = (req: request.Test) =>
    req.set('Authorization', `Bearer ${analystToken}`);

  const attempt = (
    overrides: Partial<LoginAttempt>,
  ): Partial<LoginAttempt> => ({
    userId: null,
    email,
    ip,
    country: null,
    deviceFingerprint: 'f'.repeat(64),
    userAgent: 'e2e',
    success: false,
    emailExists: false,
    blocked: false,
    riskScore: 0,
    riskLevel: 'none',
    signals: [],
    ...overrides,
  });

  beforeAll(async () => {
    const dbName = process.env.DATABASE_NAME ?? '';
    if (!dbName.endsWith('_test')) {
      throw new Error(
        `Refusing to run e2e tests against "${dbName}": set DATABASE_NAME to a database ending in _test`,
      );
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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

    const users = app.get(UsersService);
    const jwt = app.get(JwtService);
    const tokenFor = async (role: UserRole) => {
      const user = await users.create({
        email: `${role}-${run}@detection.test`,
        password: 'long-enough-password',
        role,
      });
      return jwt.signAsync({
        sub: user.id,
        email: user.email,
        role: user.role,
      });
    };
    adminToken = await tokenFor(UserRole.ADMIN);
    analystToken = await tokenFor(UserRole.ANALYST);

    const attempts = db.getRepository(LoginAttempt);
    await attempts.save([
      attempts.create(attempt({})),
      attempts.create(
        attempt({
          riskScore: 50,
          riskLevel: 'high',
          signals: [
            {
              rule: 1,
              type: 'brute_force',
              severity: 'high',
              message: 'Brute force: 20 from this IP',
            },
          ],
        }),
      ),
      attempts.create(attempt({ blocked: true })),
    ]);

    const lockouts = db.getRepository(Lockout);
    const now = Date.now();
    const [active, expired] = await lockouts.save([
      lockouts.create({
        targetType: 'ip',
        target: ip,
        ip,
        reason: 'brute_force',
        lockedUntil: new Date(now + 15 * 60_000),
      }),
      lockouts.create({
        targetType: 'email',
        target: email,
        ip,
        reason: 'brute_force',
        lockedUntil: new Date(now - 60_000),
      }),
    ]);
    activeLockId = active.id;
    expiredLockId = expired.id;
  });

  afterAll(async () => {
    await db?.getRepository(LoginAttempt).delete({ ip });
    await db
      ?.getRepository(Lockout)
      .delete({ id: In([activeLockId, expiredLockId]) });
    await app?.close();
  });

  it('hides the routes from callers without a token', async () => {
    await http().get('/detection/login-attempts').expect(404);
  });

  it('lists attempts for an IP, newest first, without the device fingerprint', async () => {
    const res = await asAnalyst(
      http().get(`/detection/login-attempts?ip=${ip}`),
    ).expect(200);
    expect(res.body).toMatchObject({ total: 3, page: 1 });
    expect(res.body.data[0]).not.toHaveProperty('deviceFingerprint');
    expect(res.body.data[0]).toHaveProperty('signals');
  });

  it('keeps only flagged attempts: a rule fired or a lockout refused them', async () => {
    const res = await asAnalyst(
      http().get(`/detection/login-attempts?ip=${ip}&flagged=true`),
    ).expect(200);
    expect(res.body.total).toBe(2);
    const levels = res.body.data.map((a: LoginAttempt) =>
      a.blocked ? 'blocked' : a.riskLevel,
    );
    expect(levels.sort()).toEqual(['blocked', 'high']);
  });

  it('filters by risk level and email, and rejects bad filters', async () => {
    const res = await asAnalyst(
      http().get(
        `/detection/login-attempts?riskLevel=high&email=${encodeURIComponent(email.toUpperCase())}`,
      ),
    ).expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].signals[0].type).toBe('brute_force');
    await asAnalyst(
      http().get('/detection/login-attempts?riskLevel=extreme'),
    ).expect(400);
    await asAnalyst(http().get('/detection/login-attempts?limit=500')).expect(
      400,
    );
  });

  it('lists only lockouts still in force', async () => {
    const res = await asAnalyst(http().get('/detection/lockouts')).expect(200);
    const ids = res.body.map((l: Lockout) => l.id);
    expect(ids).toContain(activeLockId);
    expect(ids).not.toContain(expiredLockId);
  });

  it('exposes the thresholds and weights used to score', async () => {
    const res = await asAnalyst(http().get('/detection/config')).expect(200);
    expect(res.body.rules.bruteForce).toMatchObject({
      threshold: 20,
      windowSeconds: 60,
    });
    expect(res.body.severityWeights).toMatchObject({ low: 10, critical: 100 });
    expect(res.body.scoreThresholds).toMatchObject({ medium: 20, high: 50 });
  });

  it('lets only an admin lift a lockout, and audits it', async () => {
    await asAnalyst(
      http().delete(`/detection/lockouts/${activeLockId}`),
    ).expect(403);
    await asAdmin(http().delete(`/detection/lockouts/${activeLockId}`)).expect(
      204,
    );

    const res = await asAnalyst(http().get('/detection/lockouts')).expect(200);
    expect(res.body.map((l: Lockout) => l.id)).not.toContain(activeLockId);
    await asAdmin(http().delete(`/detection/lockouts/${randomUUID()}`)).expect(
      404,
    );

    // Both are on the trail: the analyst's refused try and the admin's lift.
    let rows: AuditLog[] = [];
    for (let i = 0; i < 50 && rows.length < 2; i++) {
      rows = (await db.query(
        `SELECT * FROM "audit_logs" WHERE "action" = 'lifted_lockout' AND "targetId" = $1`,
        [activeLockId],
      )) as AuditLog[];
      if (rows.length < 2) await new Promise((r) => setTimeout(r, 100));
    }
    expect(rows.map((r) => `${r.actorRole}:${r.outcome}`).sort()).toEqual([
      'admin:success',
      'analyst:denied',
    ]);
  });
});
