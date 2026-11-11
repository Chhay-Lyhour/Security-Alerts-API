import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { NotificationsService } from './notifications.service.js';
import { Notification } from './entities/notification.entity.js';
import { NotificationChannel } from './entities/notification-channel.enum.js';
import { NotificationStatus } from './entities/notification-status.enum.js';
import { NotificationSender } from './channels/notification-sender.js';
import { NOTIFICATION_ATTEMPTS, NOTIFICATIONS_QUEUE } from './notifications.constants.js';

describe('NotificationsService', () => {
  let service: NotificationsService;
  const repo = {
    create: vi.fn((data: Partial<Notification>) => data),
    save: vi.fn(async (data: Partial<Notification>) => ({ id: `n-${data.channel}`, ...data })),
    update: vi.fn(),
    findOne: vi.fn(),
  };
  const queue = { add: vi.fn() };
  const sender = { enabledChannels: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(Notification), useValue: repo },
        { provide: getQueueToken(NOTIFICATIONS_QUEUE), useValue: queue },
        { provide: NotificationSender, useValue: sender },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  it('saves a pending notification and queues a retrying job keyed by its id', async () => {
    await service.create('alert-1', NotificationChannel.SLACK);

    expect(repo.save).toHaveBeenCalledWith({ alertId: 'alert-1', channel: NotificationChannel.SLACK });
    expect(queue.add).toHaveBeenCalledWith(
      'send-notification',
      { notificationId: 'n-slack' },
      expect.objectContaining({
        jobId: 'n-slack',
        attempts: NOTIFICATION_ATTEMPTS,
        backoff: expect.objectContaining({ type: 'exponential' }),
      }),
    );
  });

  it('marks the notification failed and rethrows when the queue is unreachable', async () => {
    queue.add.mockRejectedValueOnce(new Error('redis down'));

    await expect(service.create('alert-1', NotificationChannel.EMAIL)).rejects.toThrow('redis down');
    expect(repo.update).toHaveBeenCalledWith(
      'n-email',
      expect.objectContaining({ status: NotificationStatus.FAILED, lastError: 'redis down' }),
    );
  });

  it('creates one notification per enabled channel', async () => {
    sender.enabledChannels.mockReturnValue([NotificationChannel.SLACK, NotificationChannel.DISCORD]);

    const created = await service.notifyAlert('alert-1');

    expect(created).toHaveLength(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('queues nothing when no channel is configured', async () => {
    sender.enabledChannels.mockReturnValue([]);

    expect(await service.notifyAlert('alert-1')).toEqual([]);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
