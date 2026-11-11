import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity.js';
import { NotificationChannel } from './entities/notification-channel.enum.js';
import { NotificationStatus } from './entities/notification-status.enum.js';
import { NotificationSender } from './channels/notification-sender.js';
import { NOTIFICATION_ATTEMPTS, NOTIFICATION_BACKOFF_MS, NOTIFICATIONS_QUEUE, SEND_NOTIFICATION_JOB, type NotificationJobData } from './notifications.constants.js';

const MAX_ERROR_LENGTH = 1000;

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(
        @InjectRepository(Notification)
        private readonly notificationRepository: Repository<Notification>,

        @InjectQueue(NOTIFICATIONS_QUEUE)
        private readonly notificationQueue: Queue<NotificationJobData>,

        private readonly sender: NotificationSender,
    ) {}

    /** Queues one notification per configured channel. */
    async notifyAlert(alertId: string): Promise<Notification[]> {
        const channels = this.sender.enabledChannels();
        if (!channels.length) {
            this.logger.warn(`No notification channels configured; alert ${alertId} was not sent anywhere`);
            return [];
        }
        return Promise.all(channels.map((channel) => this.create(alertId, channel)));
    }

    /** Saves a pending Notification and adds its delivery job to the queue. */
    async create(alertId: string, channel: NotificationChannel): Promise<Notification> {
        const saved = await this.notificationRepository.save(
            this.notificationRepository.create({ alertId, channel }),
        );

        try {
            await this.notificationQueue.add(
                SEND_NOTIFICATION_JOB,
                { notificationId: saved.id },
                {
                    jobId: saved.id,
                    attempts: NOTIFICATION_ATTEMPTS,
                    backoff: { type: 'exponential', delay: NOTIFICATION_BACKOFF_MS },
                    removeOnComplete: 1000,
                    removeOnFail: 5000,
                },
            );
        } catch (error) {
            await this.markAsFailed(saved.id, error);
            throw error;
        }

        return saved;
    }

    // Loads a notification together with the alert it is about.
    async findForDelivery(id: string): Promise<Notification | null> {
        return this.notificationRepository.findOne({
            where: { id },
            relations: { alert: true },
        });
    }

    async markAsSent(id: string, attempts: number): Promise<void> {
        await this.notificationRepository.update(id, {
            status: NotificationStatus.SENT,
            sentAt: new Date(),
            attempts,
            lastError: null,
        });
    }

    /** Records a failed attempt. The notification stays pending while retries remain. */
    async recordFailedAttempt(id: string, attempts: number, error: unknown): Promise<void> {
        await this.notificationRepository.update(id, { attempts, lastError: errorMessage(error) });
    }

    async markAsFailed(id: string, error: unknown, attempts?: number): Promise<void> {
        await this.notificationRepository.update(id, {
            status: NotificationStatus.FAILED,
            lastError: errorMessage(error),
            ...(attempts !== undefined && { attempts }),
        });
    }

    async findOne(id: string): Promise<Notification> {
        const notification = await this.notificationRepository.findOne({ where: { id } });
        if (!notification) {
            throw new NotFoundException(`Notification with ID ${id} not found`);
        }
        return notification;
    }
}

function errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, MAX_ERROR_LENGTH);
}
