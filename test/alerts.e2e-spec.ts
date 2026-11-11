import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { UserRole } from '../src/users/entities/user-role.enum.js';
import { UsersService } from '../src/users/users.service.js';

/**
 * Runs against a real Postgres. Point it at a separate, migrated test
 * database, because every table is emptied before the run:
 *
 *   createdb security_alerts_test
 *   DATABASE_NAME=security_alerts_test npm run migration:run
 *   DATABASE_NAME=security_alerts_test npm run test:e2e
 */
describe('Sources and alerts (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;
  let analystToken: string;
  let apiKey: string;

  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${adminToken}`);
  const asAnalyst = (req: request.Test) =>
    req.set('Authorization', `Bearer ${analystToken}`);
  const ingest = (body: object, key = apiKey) =>
    http().post('/alerts').set('x-api-key', key).send(body);

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
    // Same pipe as main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    await app
      .get(DataSource)
      .query('TRUNCATE "alerts", "sources", "refresh_tokens", "users" CASCADE');

    const users = app.get(UsersService);
    const jwt = app.get(JwtService);
    const tokenFor = async (email: string, role: UserRole) => {
      const user = await users.create({
        email,
        password: 'long-enough-password',
        role,
      });
      return jwt.signAsync({
        sub: user.id,
        email: user.email,
        role: user.role,
      });
    };
    adminToken = await tokenFor('admin@example.com', UserRole.ADMIN);
    analystToken = await tokenFor('analyst@example.com', UserRole.ANALYST);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('POST /sources', () => {
    it('lets an admin create a source and returns the API key once', async () => {
      const res = await asAdmin(http().post('/sources'))
        .send({ name: 'web-1' })
        .expect(201);

      expect(res.body.apiKey).toMatch(/^sa_/);
      expect(res.body).not.toHaveProperty('apiKeyHash');
      apiKey = res.body.apiKey;

      const list = await asAdmin(http().get('/sources')).expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).not.toHaveProperty('apiKey');
    });

    it('answers 403 to an analyst', async () => {
      await asAnalyst(http().post('/sources'))
        .send({ name: 'web-2' })
        .expect(403);
      await asAnalyst(http().get('/sources')).expect(403);
    });
  });

  describe('POST /alerts', () => {
    const valid = {
      title: 'Failed login',
      severity: 'high',
      type: 'failed_login',
    };

    it('answers 401 without an API key', async () => {
      await http().post('/alerts').send(valid).expect(401);
    });

    it('answers 401 with a wrong API key', async () => {
      await ingest(valid, 'sa_not-a-real-key').expect(401);
      await ingest(valid, `${apiKey.slice(0, -1)}x`).expect(401);
    });

    it('answers 400 on a bad body', async () => {
      const res = await ingest({
        title: '',
        severity: 'urgent',
        type: 'Bad Type',
      }).expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringMatching(/severity/)]),
      );
    });

    it('answers 400 when the body tries to set the source', async () => {
      await ingest({
        ...valid,
        sourceId: '00000000-0000-4000-8000-000000000000',
      }).expect(400);
    });

    it('saves a valid alert as open and returns 201', async () => {
      const res = await ingest({
        ...valid,
        ipAddress: '203.0.113.7',
        payload: { user: 'bob' },
      }).expect(201);
      expect(res.body).toMatchObject({
        status: 'open',
        severity: 'high',
        ipAddress: '203.0.113.7',
        payload: { user: 'bob' },
      });
    });
  });

  describe('GET /alerts', () => {
    let resolvedId: string;

    beforeAll(async () => {
      await app.get(DataSource).query('TRUNCATE "alerts"');
      const seed = [
        { severity: 'low', type: 'new_ip' },
        { severity: 'high', type: 'failed_login' },
        { severity: 'high', type: 'failed_login' },
        { severity: 'high', type: 'port_scan' },
        { severity: 'critical', type: 'possible_compromise' },
      ];
      const ids: string[] = [];
      for (const alert of seed) {
        const res = await ingest({ title: alert.type, ...alert }).expect(201);
        ids.push(res.body.id);
      }
      resolvedId = ids[3];
      await asAnalyst(http().patch(`/alerts/${resolvedId}/status`))
        .send({ status: 'resolved' })
        .expect(200);
    });

    it('returns { data, total, page } with everything when there are no filters', async () => {
      const res = await asAnalyst(http().get('/alerts')).expect(200);
      expect(res.body).toMatchObject({ total: 5, page: 1 });
      expect(res.body.data).toHaveLength(5);
    });

    it('filters by severity', async () => {
      const res = await asAnalyst(http().get('/alerts?severity=high')).expect(
        200,
      );
      expect(res.body.total).toBe(3);
      expect(
        res.body.data.every((a: { severity: string }) => a.severity === 'high'),
      ).toBe(true);
    });

    it('combines severity and status', async () => {
      const res = await asAnalyst(
        http().get('/alerts?severity=high&status=open'),
      ).expect(200);
      expect(res.body.total).toBe(2);
      expect(res.body.data.map((a: { id: string }) => a.id)).not.toContain(
        resolvedId,
      );
    });

    it('filters by type', async () => {
      const res = await asAnalyst(
        http().get('/alerts?type=failed_login'),
      ).expect(200);
      expect(res.body.total).toBe(2);
    });

    it('filters by time range', async () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const past = new Date(Date.now() - 60_000).toISOString();
      const none = await asAnalyst(http().get(`/alerts?from=${future}`)).expect(
        200,
      );
      expect(none.body.total).toBe(0);
      const all = await asAnalyst(
        http().get(`/alerts?from=${past}&to=${future}`),
      ).expect(200);
      expect(all.body.total).toBe(5);
    });

    it('paginates, newest first', async () => {
      const page1 = await asAnalyst(
        http().get('/alerts?limit=2&page=1'),
      ).expect(200);
      const page3 = await asAnalyst(
        http().get('/alerts?limit=2&page=3'),
      ).expect(200);
      expect(page1.body).toMatchObject({ total: 5, page: 1, limit: 2 });
      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.data[0].type).toBe('possible_compromise');
      expect(page3.body.data).toHaveLength(1);
    });

    it('answers 400 on bad filters', async () => {
      await asAnalyst(http().get('/alerts?severity=urgent')).expect(400);
      await asAnalyst(http().get('/alerts?limit=500')).expect(400);
    });

    it('answers 404 for a missing alert', async () => {
      await asAnalyst(
        http().get('/alerts/00000000-0000-4000-8000-000000000000'),
      ).expect(404);
    });
  });

  describe('PATCH /alerts/:id/status and DELETE /alerts/:id', () => {
    let id: string;

    beforeAll(async () => {
      const res = await ingest({
        title: 'x',
        severity: 'medium',
        type: 'port_scan',
      }).expect(201);
      id = res.body.id;
    });

    it('lets an analyst acknowledge an alert', async () => {
      const res = await asAnalyst(http().patch(`/alerts/${id}/status`))
        .send({ status: 'acknowledged' })
        .expect(200);
      expect(res.body.status).toBe('acknowledged');
    });

    it('answers 400 for a status that is not allowed', async () => {
      await asAnalyst(http().patch(`/alerts/${id}/status`))
        .send({ status: 'open' })
        .expect(400);
    });

    it('answers 403 when an analyst tries to delete', async () => {
      await asAnalyst(http().delete(`/alerts/${id}`)).expect(403);
    });

    it('lets an admin delete', async () => {
      await asAdmin(http().delete(`/alerts/${id}`)).expect(204);
      await asAdmin(http().get(`/alerts/${id}`)).expect(404);
    });
  });
});
