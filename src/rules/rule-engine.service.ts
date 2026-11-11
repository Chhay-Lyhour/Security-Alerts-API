import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type SelectQueryBuilder } from 'typeorm';
import { Alert } from '../alerts/entities/alert.entity.js';
import { AlertsService } from '../alerts/alerts.service.js';
import { ALERT_CREATED, AlertCreatedEvent } from '../alerts/events/alert-created.event.js';
import type { Source } from '../sources/entities/source.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AlertRule } from './entities/alert-rule.entity.js';
import { RulesService } from './rules.service.js';

export interface EscalationPayload {
    ruleId: string;
    ruleName: string;
    triggeredByAlertId: string;
    matchedCount: number;
    threshold: number;
    windowSeconds: number;
}

@Injectable()
export class RuleEngineService {
    private readonly logger = new Logger(RuleEngineService.name);

    constructor(
        private readonly rules: RulesService,
        private readonly alerts: AlertsService,
        @InjectRepository(Alert) private readonly alertRepository: Repository<Alert>,
        private readonly notifications: NotificationsService,
    ) {}

    @OnEvent(ALERT_CREATED, { async: true })
    async handleAlertCreated({ alertId }: AlertCreatedEvent): Promise<void> {
        try {
            // The event only carries a summary; the rules need createdAt, sourceId and payload.
            const alert = await this.alertRepository.findOne({ where: { id: alertId } });
            if (alert) await this.evaluate(alert);
        } catch (error) {
            // Detection runs after the ingest response; never let it crash the process.
            this.logger.error(
                `Rule evaluation failed for alert ${alertId}: ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error.stack : undefined,
            );
        }
    }

    // Returns the escalated alerts created for this alert. 
    async evaluate(alert: Alert): Promise<Alert[]> {
        // Escalations come back through `alert.created`; don't feed them to the rules again.
        if (isEscalation(alert)) return [];

        const rules = await this.rules.findEnabledByType(alert.type);
        const escalated: Alert[] = [];
        for (const rule of rules) {
            const created = await this.applyRule(rule, alert);
            if (created) escalated.push(created);
        }
        return escalated;
    }

    private async applyRule(rule: AlertRule, alert: Alert): Promise<Alert | null> {
        const since = new Date(new Date(alert.createdAt).getTime() - rule.windowSeconds * 1000);

        const matchedCount = await this.sameOrigin(alert, since)
            .andWhere('a.type = :type', { type: rule.type })
            // Escalated alerts don't count towards their own rule.
            .andWhere(`a.payload->>'ruleId' IS NULL`)
            .getCount();
        if (matchedCount < rule.threshold) return null;

        const alreadyEscalated = await this.sameOrigin(alert, since)
            .andWhere(`a.payload->>'ruleId' = :ruleId`, { ruleId: rule.id })
            .getExists();
        if (alreadyEscalated) return null;

        const payload: EscalationPayload = {
            ruleId: rule.id,
            ruleName: rule.name,
            triggeredByAlertId: alert.id,
            matchedCount,
            threshold: rule.threshold,
            windowSeconds: rule.windowSeconds,
        };
        // Same path as external ingest, so the escalation is saved and emits
        // alert.created like any other alert. ingest() only reads source.id.
        const escalation = await this.alerts.ingest({ id: alert.sourceId } as Source, {
            title: `Rule "${rule.name}": ${matchedCount} ${rule.type} alerts in ${rule.windowSeconds}s`.slice(0, 200),
            type: rule.type,
            severity: rule.severity,
            ipAddress: alert.ipAddress ?? undefined,
            payload: { ...payload },
        });
        this.logger.warn(
            `Rule "${rule.name}" triggered by alert ${alert.id} (${matchedCount}/${rule.threshold} in ${rule.windowSeconds}s); escalated alert ${escalation.id} [${rule.severity}]`,
        );

        await this.notifications.notifyAlert(escalation.id);
        return escalation;
    }

    // Alerts from the same IP (or the same source when there is no IP) since `since`.
    private sameOrigin(alert: Alert, since: Date): SelectQueryBuilder<Alert> {
        const qb = this.alertRepository
            .createQueryBuilder('a')
            .where('a."createdAt" >= :since', { since });
        return alert.ipAddress
            ? qb.andWhere('a."ipAddress" = :ip', { ip: alert.ipAddress })
            : qb.andWhere('a."ipAddress" IS NULL').andWhere('a."sourceId" = :sourceId', { sourceId: alert.sourceId });
    }
}

function isEscalation(alert: Alert): boolean {
    return typeof alert.payload?.ruleId === 'string';
}
