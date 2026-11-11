import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { NotificationsService } from './notifications.service.js';
import { NotificationSender } from './channels/notification-sender.js';
import { NotificationStatus } from './entities/notification-status.enum.js';
import { NOTIFICATIONS_QUEUE, type NotificationJobData } from './notifications.constants.js';

/**
 * BullMQ worker for the "notifications" queue (SPECS.md section 4, step 4).
 *
 *   success                -> Notification(status = sent)
 *   failure, retries left  -> error recorded, rethrown so BullMQ retries
 *                             with exponential backoff
 *   last attempt failed or
 *   unrecoverable error    -> Notification(status = failed)
 */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
    private readonly logger = new Logger(NotificationsProcessor.name);

    constructor(
        private readonly notifications: NotificationsService,
        private readonly sender: NotificationSender,
    ) {
        super();
    }

    async process(job: Job<NotificationJobData>): Promise<void> {
        const { notificationId } = job.data;
        // attemptsMade counts earlier failed attempts, so this one is +1.
        const attempt = job.attemptsMade + 1;
        const maxAttempts = job.opts.attempts ?? 1;

        const notification = await this.notifications.findForDelivery(notificationId);
        if (!notification) {
            // Deleted together with its alert: nothing left to deliver.
            throw new UnrecoverableError(`Notification ${notificationId} no longer exists`);
        }
        if (notification.status === NotificationStatus.SENT) return;

        try {
            await this.sender.send(notification.channel, notification.alert);
        } catch (error) {
            const final = error instanceof UnrecoverableError || attempt >= maxAttempts;
            if (final) {
                await this.notifications.markAsFailed(notificationId, error, attempt);
                this.logger.error(
                    `Notification ${notificationId} (${notification.channel}) failed after ${attempt} attempt(s): ${describe(error)}`,
                );
            } else {
                await this.notifications.recordFailedAttempt(notificationId, attempt, error);
                this.logger.warn(
                    `Notification ${notificationId} (${notification.channel}) attempt ${attempt}/${maxAttempts} failed, retrying: ${describe(error)}`,
                );
            }
            throw error;
        }

        await this.notifications.markAsSent(notificationId, attempt);
        this.logger.log(`Notification ${notificationId} sent via ${notification.channel}`);
    }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
