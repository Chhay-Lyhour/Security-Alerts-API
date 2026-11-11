import type { Repository } from 'typeorm';
import { RuleEngineService } from './rule-engine.service.js';
import type { RulesService } from './rules.service.js';
import type { AlertsService } from '../alerts/alerts.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { Alert } from '../alerts/entities/alert.entity.js';
import type { AlertRule } from './entities/alert-rule.entity.js';
import { AlertSeverity } from '../alerts/entities/alert-severity.enum.js';
import { AlertStatus } from '../alerts/entities/alert-status.enum.js';
import { AlertCreatedEvent } from '../alerts/events/alert-created.event.js';

describe('RuleEngineService', () => {
  const rule: AlertRule = {
    id: 'rule-1',
    name: '5 failed logins in 60s',
    type: 'failed_login',
    threshold: 5,
    windowSeconds: 60,
    severity: AlertSeverity.HIGH,
    isEnabled: true,
    createdAt: new Date(),
  };
  const incoming: Alert = {
    id: 'alert-1',
    title: 'Failed login',
    type: 'failed_login',
    payload: {},
    ipAddress: '203.0.113.7',
    severity: AlertSeverity.LOW,
    status: AlertStatus.OPEN,
    sourceId: 'source-1',
    createdAt: new Date('2026-11-11T10:00:00Z'),
  };

  let count: number;
  let exists: boolean;
  const qb = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getCount: vi.fn(async () => count),
    getExists: vi.fn(async () => exists),
  };
  const rules = { findEnabledByType: vi.fn() };
  const alerts = { ingest: vi.fn(async (_source: unknown, dto: Partial<Alert>) => ({ ...dto, id: 'escalated-1' })) };
  const alertRepo = { createQueryBuilder: vi.fn(() => qb), findOne: vi.fn() };
  const notifications = { notifyAlert: vi.fn() };

  const engine = new RuleEngineService(
    rules as unknown as RulesService,
    alerts as unknown as AlertsService,
    alertRepo as unknown as Repository<Alert>,
    notifications as unknown as NotificationsService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    rules.findEnabledByType.mockResolvedValue([rule]);
    count = 0;
    exists = false;
  });

  it('does nothing below the threshold', async () => {
    count = 4;

    expect(await engine.evaluate(incoming)).toEqual([]);
    expect(alerts.ingest).not.toHaveBeenCalled();
    expect(notifications.notifyAlert).not.toHaveBeenCalled();
  });

  it('escalates with the rule severity and queues notifications at the threshold', async () => {
    count = 5;

    const [escalated] = await engine.evaluate(incoming);

    expect(alerts.ingest).toHaveBeenCalledWith(
      { id: 'source-1' },
      expect.objectContaining({
        type: 'failed_login',
        severity: AlertSeverity.HIGH,
        ipAddress: '203.0.113.7',
        payload: expect.objectContaining({ ruleId: 'rule-1', triggeredByAlertId: 'alert-1', matchedCount: 5 }),
      }),
    );
    expect(notifications.notifyAlert).toHaveBeenCalledWith(escalated.id);
  });

  it('escalates once per window', async () => {
    count = 9;
    exists = true;

    expect(await engine.evaluate(incoming)).toEqual([]);
    expect(alerts.ingest).not.toHaveBeenCalled();
  });

  it('ignores alerts the engine raised itself', async () => {
    count = 100;

    await engine.evaluate({ ...incoming, payload: { ruleId: 'rule-1' } });
    expect(rules.findEnabledByType).not.toHaveBeenCalled();
  });

  it('matches by source when the alert has no IP', async () => {
    count = 5;

    await engine.evaluate({ ...incoming, ipAddress: null });
    expect(qb.andWhere).toHaveBeenCalledWith('a."sourceId" = :sourceId', { sourceId: 'source-1' });
  });

  const event = new AlertCreatedEvent(incoming.id, incoming.type, incoming.severity, incoming.ipAddress);

  it('loads the alert named by the alert.created event and evaluates it', async () => {
    alertRepo.findOne.mockResolvedValueOnce(incoming);
    count = 5;

    await engine.handleAlertCreated(event);
    expect(alertRepo.findOne).toHaveBeenCalledWith({ where: { id: 'alert-1' } });
    expect(alerts.ingest).toHaveBeenCalledTimes(1);
  });

  it('logs instead of throwing when evaluation fails', async () => {
    alertRepo.findOne.mockRejectedValueOnce(new Error('db down'));

    await expect(engine.handleAlertCreated(event)).resolves.toBeUndefined();
  });
});
