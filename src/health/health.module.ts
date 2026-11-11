import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.constants.js';
import { HealthController } from './health.controller.js';

@Module({
  // Reuses the notifications queue's Redis connection for the ping.
  imports: [BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  controllers: [HealthController],
})
export class HealthModule {}
