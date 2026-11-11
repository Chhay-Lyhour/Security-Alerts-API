import { ServiceUnavailableException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { DataSource } from 'typeorm';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  const db = { query: vi.fn() };
  const queue = { isPaused: vi.fn() };
  const controller = new HealthController(
    db as unknown as DataSource,
    queue as unknown as Queue,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockResolvedValue([{ '?column?': 1 }]);
    queue.isPaused.mockResolvedValue(false);
  });

  it('is ok when Postgres and Redis both answer', async () => {
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it.each([
    ['database', () => db.query.mockRejectedValue(new Error('ECONNREFUSED'))],
    [
      'redis',
      () => queue.isPaused.mockRejectedValue(new Error('ECONNREFUSED')),
    ],
  ])(
    'answers 503 and names the failing check when %s is down',
    async (name, breakIt) => {
      breakIt();
      const error = await controller.check().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(
        (error as ServiceUnavailableException).getResponse(),
      ).toMatchObject({
        status: 'error',
        checks: { [name]: 'down' },
      });
    },
  );
});
