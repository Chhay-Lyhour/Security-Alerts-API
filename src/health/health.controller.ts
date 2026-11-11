import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { Public } from '../common/decorators/public.decorator.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';

type Check = 'up' | 'down';

const CHECK_TIMEOUT_MS = 2_000;

/**
 * Liveness and readiness for Docker and load balancers: 200 when Postgres
 * and Redis both answer, 503 otherwise. Says nothing about versions or
 * hosts, since it is public.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DataSource,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  @Get()
  async check() {
    const [database, redis] = await Promise.all([
      probe(() => this.db.query('SELECT 1')),
      // Any command that has to reach Redis will do.
      probe(() => this.queue.isPaused()),
    ]);
    const body = {
      status: database === 'up' && redis === 'up' ? 'ok' : 'error',
      checks: { database, redis },
    };
    if (body.status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }
}

async function probe(run: () => Promise<unknown>): Promise<Check> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([run(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}
