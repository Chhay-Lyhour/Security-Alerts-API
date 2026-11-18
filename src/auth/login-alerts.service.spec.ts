import type { AlertsService } from '../alerts/alerts.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { SourcesService } from '../sources/sources.service.js';
import type { LoginAttempt } from './entities/login-attempt.entity.js';
import {
  LOGIN_ENGINE_SOURCE,
  LoginAlertsService,
} from './login-alerts.service.js';
import type { LoginAssessment } from './login-detector.service.js';

const attempt = {
  id: 'att-1',
  email: 'admin@lotus.demo',
  userId: 'u1',
  ip: '198.51.100.4',
} as LoginAttempt;
const assessment = (level: LoginAssessment['level']): LoginAssessment => ({
  level,
  score: level === 'critical' ? 110 : 50,
  signals: [
    { rule: 8, type: 'new_ip', severity: 'low', message: 'new ip' },
    {
      rule: 1,
      type: 'brute_force',
      severity: 'high',
      message: 'Brute force: 20 from this IP failed logins in 60s',
    },
  ],
  decision: {
    action: 'block',
    locks: [{ target: 'ip', reason: 'brute_force', baseMinutes: 15 }],
    denyToken: false,
  },
});

describe('LoginAlertsService', () => {
  let sources: { ensureInternal: ReturnType<typeof vi.fn> };
  let alerts: { ingest: ReturnType<typeof vi.fn> };
  let notifications: { notifyAlert: ReturnType<typeof vi.fn> };
  let service: LoginAlertsService;

  beforeEach(() => {
    sources = {
      ensureInternal: vi.fn().mockResolvedValue({ id: 'src-login' }),
    };
    alerts = { ingest: vi.fn().mockResolvedValue({ id: 'alert-1' }) };
    notifications = { notifyAlert: vi.fn().mockResolvedValue([]) };
    service = new LoginAlertsService(
      sources as unknown as SourcesService,
      alerts as unknown as AlertsService,
      notifications as unknown as NotificationsService,
    );
  });

  it.each(['none', 'low', 'medium'] as const)(
    'stays quiet for a %s login',
    async (level) => {
      await service.raise(attempt, assessment(level));
      expect(alerts.ingest).not.toHaveBeenCalled();
      expect(notifications.notifyAlert).not.toHaveBeenCalled();
    },
  );

  it('turns a high login into an alert on the internal source and notifies', async () => {
    await service.raise(attempt, assessment('high'));
    expect(sources.ensureInternal).toHaveBeenCalledWith(LOGIN_ENGINE_SOURCE);
    expect(alerts.ingest).toHaveBeenCalledWith(
      { id: 'src-login' },
      expect.objectContaining({
        type: 'brute_force', // the most severe signal
        severity: 'high',
        ipAddress: '198.51.100.4',
        title: expect.stringMatching(/^Login engine: Brute force/),
        payload: expect.objectContaining({
          engine: 'login',
          email: 'admin@lotus.demo',
          score: 50,
          action: 'block',
          locks: ['ip'],
        }),
      }),
    );
    expect(notifications.notifyAlert).toHaveBeenCalledWith('alert-1');
  });

  it('looks the source up once', async () => {
    await service.raise(attempt, assessment('high'));
    await service.raise(attempt, assessment('critical'));
    expect(sources.ensureInternal).toHaveBeenCalledTimes(1);
    expect(alerts.ingest.mock.calls[1][1]).toMatchObject({
      severity: 'critical',
    });
  });

  it('never throws, and retries the source lookup after a failure', async () => {
    sources.ensureInternal.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.raise(attempt, assessment('high')),
    ).resolves.toBeUndefined();
    await service.raise(attempt, assessment('high'));
    expect(sources.ensureInternal).toHaveBeenCalledTimes(2);
    expect(notifications.notifyAlert).toHaveBeenCalledTimes(1);
  });
});
