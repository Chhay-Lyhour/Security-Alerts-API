import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Notification } from './entities/notification.entity.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsProcessor } from './notifications.processor.js';
import { NotificationSender } from './channels/notification-sender.js';
import { NOTIFICATIONS_QUEUE } from './notifications.constants.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  providers: [NotificationsService, NotificationsProcessor, NotificationSender],
  exports: [NotificationsService],
})
export class NotificationsModule {}
