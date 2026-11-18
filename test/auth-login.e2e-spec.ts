import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { NotificationSender } from '../src/notifications/channels/notification-sender.js';
import { UserRole } from '../src/users/entities/user-role.enum.js';
import { UsersService } from '../src/users/users.service.js';

/**
 * The login flow end to end: an admin creates the account, log in, login detection recording
 * the attempt and the device, refresh-token rotation and logout.
 *
 *   DATABASE_NAME=security_alerts_test npm run test:e2e
 *
 * Stays under the login rate limit (5 per minute per IP) and uses a unique
 * email, so it can share the test database with the other suites.
 */
describe('Login flow (e2e)', () => {
  const email = `user-${randomUUID().slice(0, 8)}@login.test`;
  const password = 'correct-horse-battery';
  const laptop =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15';
  const phone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

  let app: INestApplication<App>;
  let db: DataSource;
  let userId: string;
  let accessToken: string;
  let refreshToken: string;
  let adminToken: string;
  let adminId: string;

  const http = () => request(app.getHttpServer());
  const attempts = () =>
    db.query(
      `SELECT "success", "emailExists", "userAgent" FROM "login_attempts" WHERE "email" = $1 ORDER BY "createdAt"`,
      [email],
    ) as Promise<
      { success: boolean; emailExists: boolean; userAgent: string }[]
    >;

  beforeAll(async () => {
    const dbName = process.env.DATABASE_NAME ?? '';
    if (!dbName.endsWith('_test')) {
      throw new Error(
        `Refusing to run e2e tests against "${dbName}": set DATABASE_NAME to a database ending in _test`,
      );
    }
    // Never send real notifications from tests, whatever .env says.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(NotificationSender)
      .useValue({ enabledChannels: () => [], send: async () => undefined })
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

    const admin = await app.get(UsersService).create({
      email: `admin-${randomUUID().slice(0, 8)}@login.test`,
      password: 'long-enough-password',
      role: UserRole.ADMIN,
    });
    adminId = admin.id;
    adminToken = await app
      .get(JwtService)
      .signAsync({ sub: admin.id, email: admin.email, role: admin.role });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('has no public sign-up: only an admin creates accounts', async () => {
    await http().post('/auth/register').send({ email, password }).expect(404);
    await http().post('/users').send({ email, password }).expect(404);

    const res = await http()
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, password })
      .expect(201);
    expect(res.body).toMatchObject({ email, role: 'analyst' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
    userId = res.body.id;

    await http()
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, password })
      .expect(409);
    await http()
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: `x-${email}`, password, role: 'owner' })
      .expect(400);
  });

  it('logs in, records a successful attempt and remembers the device as untrusted', async () => {
    const res = await http()
      .post('/auth/login')
      .set('User-Agent', laptop)
      .send({ email, password })
      .expect(200);
    expect(res.body).toMatchObject({
      tokenType: 'Bearer',
      user: { id: userId },
    });
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;

    expect(await attempts()).toEqual([
      { success: true, emailExists: true, userAgent: laptop },
    ]);

    const devices = await http()
      .get('/devices')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(devices.body).toHaveLength(1);
    expect(devices.body[0]).toMatchObject({ isTrusted: false });
  });

  it('answers a wrong password with a generic 401 and records the failure', async () => {
    const res = await http()
      .post('/auth/login')
      .set('User-Agent', laptop)
      .send({ email, password: 'wrong-password-1' })
      .expect(401);
    expect(res.body.message).toBe('Invalid credentials');
    expect((await attempts()).at(-1)).toMatchObject({
      success: false,
      emailExists: true,
    });
  });

  it('adds a second device when logging in from a new one', async () => {
    await http()
      .post('/auth/login')
      .set('User-Agent', phone)
      .send({ email, password })
      .expect(200);
    const devices = await http()
      .get('/devices')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(devices.body).toHaveLength(2);
  });

  it('protects GET /auth/me: 404 without a token (hidden), 401 with a bad one', async () => {
    const me = await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ id: userId, email, role: 'analyst' });

    await http().get('/auth/me').expect(404);
    await http()
      .get('/auth/me')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);
  });

  it('lets an admin list users and change roles, but not their own', async () => {
    const list = await http()
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.map((u: { id: string }) => u.id)).toContain(userId);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash/);

    await http()
      .patch(`/users/${adminId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'analyst' })
      .expect(400);
    await http()
      .patch(`/users/${randomUUID()}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'admin' })
      .expect(404);

    // Promote, check it applies at once (the role is re-read per request), demote.
    await http()
      .patch(`/users/${userId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'admin' })
      .expect(200);
    await http()
      .get('/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    await http()
      .patch(`/users/${userId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'analyst' })
      .expect(200);

    let rows: { action: string; metadata: Record<string, unknown> }[] = [];
    for (let i = 0; i < 50 && rows.length < 3; i++) {
      rows = (await db.query(
        `SELECT "action", "metadata" FROM "audit_logs" WHERE "targetId" = $1 AND "outcome" = 'success' ORDER BY "createdAt"`,
        [userId],
      )) as typeof rows;
      if (rows.length < 3) await new Promise((r) => setTimeout(r, 100));
    }
    expect(rows).toEqual(
      [
        { action: 'created_user', metadata: { email, role: undefined } },
        { action: 'changed_user_role', metadata: { role: 'admin' } },
        { action: 'changed_user_role', metadata: { role: 'analyst' } },
      ].map((r) => ({
        ...r,
        metadata: JSON.parse(JSON.stringify(r.metadata)),
      })),
    );
  });

  it('keeps analysts out of admin routes', async () => {
    await http()
      .get('/audit')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    await http()
      .post('/sources')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'not-allowed' })
      .expect(403);
    await http()
      .post('/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: `y-${email}`, password })
      .expect(403);
  });

  it('rotates the refresh token: the old one stops working', async () => {
    const res = await http()
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(res.body.refreshToken).not.toBe(refreshToken);

    await http().post('/auth/refresh').send({ refreshToken }).expect(401);
    refreshToken = res.body.refreshToken;
  });

  it('logs out: the session can no longer be refreshed', async () => {
    await http().post('/auth/logout').send({ refreshToken }).expect(204);
    await http().post('/auth/refresh').send({ refreshToken }).expect(401);
  });
});
