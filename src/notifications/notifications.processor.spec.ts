import { UnrecoverableError, type Job } from 'bullmq';
import { NotificationsProcessor } from './notifications.processor.js';
import type { NotificationsService } from './notifications.service.js';
import type { NotificationSender } from './channels/notification-sender.js';
import { NotificationChannel } from './entities/notification-channel.enum.js';
import { NotificationStatus } from './entities/notification-status.enum.js';
import type { NotificationJobData } from './notifications.constants.js';

describe('NotificationsProcessor', () => {
  const alert = { id: 'alert-1' };
  const notifications = {
    findForDelivery: vi.fn(),
    markAsSent: vi.fn(),
    markAsFailed: vi.fn(),
    recordFailedAttempt: vi.fn(),
  };
  const sender = { send: vi.fn() };
  const processor = new NotificationsProcessor(
    notifications as unknown as NotificationsService,
    sender as unknown as NotificationSender,
  );

  const job = (attemptsMade: number) =>
    ({ data: { notificationId: 'n-1' }, attemptsMade, opts: { attempts: 3 } }) as Job<NotificationJobData>;

  beforeEach(() => {
    vi.clearAllMocks();
    notifications.findForDelivery.mockResolvedValue({
      id: 'n-1',
      channel: NotificationChannel.SLACK,
      status: NotificationStatus.PENDING,
      alert,
    });
  });

  it('sends and marks the notification sent', async () => {
    await processor.process(job(0));

    expect(sender.send).toHaveBeenCalledWith(NotificationChannel.SLACK, alert);
    expect(notifications.markAsSent).toHaveBeenCalledWith('n-1', 1);
  });

  it('records the error and rethrows so BullMQ retries while attempts remain', async () => {
    sender.send.mockRejectedValueOnce(new Error('timeout'));

    await expect(processor.process(job(1))).rejects.toThrow('timeout');
    expect(notifications.recordFailedAttempt).toHaveBeenCalledWith('n-1', 2, expect.any(Error));
    expect(notifications.markAsFailed).not.toHaveBeenCalled();
  });

  it('marks the notification failed on the last attempt', async () => {
    sender.send.mockRejectedValueOnce(new Error('timeout'));

    await expect(processor.process(job(2))).rejects.toThrow('timeout');
    expect(notifications.markAsFailed).toHaveBeenCalledWith('n-1', expect.any(Error), 3);
  });

  it('fails immediately on an unrecoverable error', async () => {
    sender.send.mockRejectedValueOnce(new UnrecoverableError('not configured'));

    await expect(processor.process(job(0))).rejects.toThrow('not configured');
    expect(notifications.markAsFailed).toHaveBeenCalledWith('n-1', expect.any(UnrecoverableError), 1);
  });

  it('does not resend a notification that was already sent', async () => {
    notifications.findForDelivery.mockResolvedValue({ status: NotificationStatus.SENT, alert });

    await processor.process(job(0));
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('gives up when the notification no longer exists', async () => {
    notifications.findForDelivery.mockResolvedValue(null);

    await expect(processor.process(job(0))).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
