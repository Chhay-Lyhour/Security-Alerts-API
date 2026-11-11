import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';

/**
 * The login flow end to end: register, log in, login detection recording
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
  });

  afterAll(async () => {
    await app?.close();
  });

  it('registers a user as an analyst and never returns the password hash', async () => {
    const res = await http()
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    expect(res.body.user).toMatchObject({ email, role: 'analyst' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
    userId = res.body.user.id;

    await http().post('/auth/register').send({ email, password }).expect(409);
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

  it('keeps analysts out of admin routes', async () => {
    await http()
      .get('/audit')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    await http()
      .get('/sources')
      .set('Authorization', `Bearer ${accessToken}`)
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
