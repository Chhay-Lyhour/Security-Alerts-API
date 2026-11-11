import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AlertSeverity } from '../alerts/entities/alert-severity.enum.js';
import { Alert } from '../alerts/entities/alert.entity.js';
import { AlertCreatedEvent } from '../alerts/events/alert-created.event.js';
import { AuditService } from '../audit/audit.service.js';
import { AutoBlockListener } from './auto-block.listener.js';
import { BlockOrigin } from './entities/block-origin.enum.js';
import { FirewallService } from './firewall.service.js';

describe('AutoBlockListener', () => {
  let listener: AutoBlockListener;
  const firewall = { check: vi.fn(), block: vi.fn() };
  const audit = { record: vi.fn() };
  const alerts = { findOne: vi.fn() };

  const escalation = {
    id: 'al-2',
    payload: { ruleId: 'r-1', ruleName: '5 failed logins' },
  };
  const event = (
    severity = AlertSeverity.HIGH,
    ip: string | null = '203.0.113.9',
  ) => new AlertCreatedEvent('al-2', 'failed_login', severity, ip);

  const build = async (minutes?: string) => {
    const module = await Test.createTestingModule({
      providers: [
        AutoBlockListener,
        { provide: FirewallService, useValue: firewall },
        { provide: AuditService, useValue: audit },
        { provide: getRepositoryToken(Alert), useValue: alerts },
        { provide: ConfigService, useValue: { get: () => minutes } },
      ],
    }).compile();
    listener = module.get(AutoBlockListener);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    alerts.findOne.mockResolvedValue(escalation);
    firewall.check.mockReturnValue({
      ip: '203.0.113.9',
      blocked: false,
      allowlisted: false,
    });
    firewall.block.mockResolvedValue({ id: 'b-1', network: '203.0.113.9/32' });
    await build();
  });

  it('blocks the IP of a high escalation for 60 minutes by default, and audits it as the system', async () => {
    await listener.handle(event());

    expect(firewall.block).toHaveBeenCalledWith(
      expect.objectContaining({
        ip: '203.0.113.9',
        origin: BlockOrigin.AUTO,
        alertId: 'al-2',
        expiresInMinutes: 60,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        actorRole: 'system',
        action: 'auto_blocked_ip',
        targetId: 'b-1',
        metadata: expect.objectContaining({ ruleId: 'r-1', alertId: 'al-2' }),
      }),
    );
  });

  it('uses FIREWALL_AUTO_BLOCK_MINUTES', async () => {
    await build('15');
    await listener.handle(event(AlertSeverity.CRITICAL));
    expect(firewall.block).toHaveBeenCalledWith(
      expect.objectContaining({ expiresInMinutes: 15 }),
    );
  });

  it('does nothing when turned off with 0', async () => {
    await build('0');
    await listener.handle(event());
    expect(firewall.block).not.toHaveBeenCalled();
  });

  it.each([AlertSeverity.LOW, AlertSeverity.MEDIUM])(
    'ignores %s alerts',
    async (severity) => {
      await listener.handle(event(severity));
      expect(alerts.findOne).not.toHaveBeenCalled();
      expect(firewall.block).not.toHaveBeenCalled();
    },
  );

  it('ignores alerts without an IP', async () => {
    await listener.handle(event(AlertSeverity.HIGH, null));
    expect(firewall.block).not.toHaveBeenCalled();
  });

  it('ignores raw ingested alerts: only rule escalations block', async () => {
    alerts.findOne.mockResolvedValue({ id: 'al-2', payload: {} });
    await listener.handle(event(AlertSeverity.CRITICAL));
    expect(firewall.block).not.toHaveBeenCalled();
  });

  it('skips IPs that are already blocked or allowlisted', async () => {
    firewall.check.mockReturnValueOnce({ blocked: true, allowlisted: false });
    await listener.handle(event());
    firewall.check.mockReturnValueOnce({ blocked: false, allowlisted: true });
    await listener.handle(event());
    expect(firewall.block).not.toHaveBeenCalled();
  });

  it('never throws, e.g. when a parallel escalation blocked the IP first', async () => {
    firewall.block.mockRejectedValueOnce(new ConflictException());
    await expect(listener.handle(event())).resolves.toBeUndefined();
    firewall.block.mockRejectedValueOnce(new Error('db down'));
    await expect(listener.handle(event())).resolves.toBeUndefined();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
