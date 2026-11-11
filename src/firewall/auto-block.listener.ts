import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AlertSeverity } from '../alerts/entities/alert-severity.enum.js';
import { Alert } from '../alerts/entities/alert.entity.js';
import {
  ALERT_CREATED,
  AlertCreatedEvent,
} from '../alerts/events/alert-created.event.js';
import { AuditOutcome } from '../audit/entities/audit-outcome.enum.js';
import { AuditService } from '../audit/audit.service.js';
import { BlockOrigin } from './entities/block-origin.enum.js';
import { FirewallService } from './firewall.service.js';

export const DEFAULT_AUTO_BLOCK_MINUTES = 60;
const AUTO_BLOCK_SEVERITIES = new Set<AlertSeverity>([
  AlertSeverity.HIGH,
  AlertSeverity.CRITICAL,
]);

/**
 * Closes the loop from detection to protection: when the rule engine
 * escalates a high or critical alert for an IP, that IP is blocked for
 * FIREWALL_AUTO_BLOCK_MINUTES (0 turns this off). Only escalations count,
 * not raw ingested alerts, so a single noisy event can't block anyone.
 */
@Injectable()
export class AutoBlockListener {
  private readonly logger = new Logger(AutoBlockListener.name);
  private readonly minutes: number;

  constructor(
    private readonly firewall: FirewallService,
    private readonly audit: AuditService,
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    config: ConfigService,
  ) {
    const raw = config.get<string>('FIREWALL_AUTO_BLOCK_MINUTES');
    this.minutes =
      raw === undefined || raw === ''
        ? DEFAULT_AUTO_BLOCK_MINUTES
        : Number(raw);
  }

  @OnEvent(ALERT_CREATED, { async: true })
  async handle(event: AlertCreatedEvent): Promise<void> {
    if (
      this.minutes <= 0 ||
      !event.ipAddress ||
      !AUTO_BLOCK_SEVERITIES.has(event.severity)
    )
      return;

    try {
      const alert = await this.alerts.findOne({ where: { id: event.alertId } });
      const ruleId = alert?.payload?.ruleId;
      if (typeof ruleId !== 'string') return;

      const verdict = this.firewall.check(event.ipAddress);
      if (verdict.blocked || verdict.allowlisted) return;

      const ruleName =
        typeof alert!.payload.ruleName === 'string'
          ? alert!.payload.ruleName
          : ruleId;
      const block = await this.firewall.block({
        ip: event.ipAddress,
        reason:
          `Automatic: rule "${ruleName}" escalated a ${event.severity} alert`.slice(
            0,
            200,
          ),
        expiresInMinutes: this.minutes,
        origin: BlockOrigin.AUTO,
        alertId: event.alertId,
      });

      await this.audit.record({
        userId: null,
        actorEmail: null,
        actorRole: 'system',
        action: 'auto_blocked_ip',
        outcome: AuditOutcome.SUCCESS,
        targetType: 'blocked_ip',
        targetId: block.id,
        method: null,
        path: null,
        statusCode: null,
        ip: verdict.ip,
        metadata: {
          alertId: event.alertId,
          ruleId,
          ruleName,
          network: block.network,
          expiresInMinutes: this.minutes,
        },
      });
    } catch (error) {
      // Two escalations for the same IP at once: the other one already blocked it.
      if (error instanceof ConflictException) return;
      this.logger.error(
        `Auto-block failed for alert ${event.alertId} (${event.ipAddress}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
