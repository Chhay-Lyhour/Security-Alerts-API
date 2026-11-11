export const NOTIFICATIONS_QUEUE = 'notifications';
export const SEND_NOTIFICATION_JOB = 'send-notification';

// Total delivery attempts per notification: the first try plus 2 retries.
export const NOTIFICATION_ATTEMPTS = 3;
// First retry waits 5s, then 10s (exponential). 
export const NOTIFICATION_BACKOFF_MS = 5_000;

export interface NotificationJobData {
    notificationId: string;
}
