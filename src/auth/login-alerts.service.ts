import { Injectable, Logger } from '@nestjs/common';
import { AlertSeverity } from '../alerts/entities/alert-severity.enum.js';
import { AlertsService } from '../alerts/alerts.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { Source } from '../sources/entities/source.entity.js';
import { SourcesService } from '../sources/sources.service.js';
import type { LoginSignal } from './detection/login-rules.js';
import type { LoginAttempt } from './entities/login-attempt.entity.js';
import type { LoginAssessment } from './login-detector.service.js';

/** Name of the internal source that login-engine alerts belong to. */
export const LOGIN_ENGINE_SOURCE = 'login-detection-engine';

const SEVERITY_RANK: Record<LoginSignal['severity'], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/**
 * Stage 03 of login detection, the "respond" half: a HIGH or CRITICAL login
 * becomes an Alert (so analysts see it with everything else) and a
 * notification on every configured channel. Lower levels stay on the
 * LoginAttempt row only, to keep the channels quiet.
 */
@Injectable()
export class LoginAlertsService {
  private readonly logger = new Logger(LoginAlertsService.name);
  private source: Promise<Source> | null = null;

  constructor(
    private readonly sources: SourcesService,
    private readonly alerts: AlertsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Never throws: the login has already been answered by the time this runs. */
  async raise(
    attempt: LoginAttempt,
    assessment: LoginAssessment,
  ): Promise<void> {
    const { level, signals, score, decision } = assessment;
    if (level !== 'high' && level !== 'critical') return;
    const top = [...signals].sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    )[0];
    if (!top) return;

    try {
      this.source ??= this.sources.ensureInternal(LOGIN_ENGINE_SOURCE);
      const source = await this.source;
      const alert = await this.alerts.ingest(source, {
        title: `Login engine: ${top.message}`.slice(0, 200),
        type: top.type,
        severity:
          level === 'critical' ? AlertSeverity.CRITICAL : AlertSeverity.HIGH,
        ipAddress: attempt.ip || undefined,
        payload: {
          engine: 'login',
          attemptId: attempt.id,
          email: attempt.email,
          userId: attempt.userId,
          score,
          action: decision.action,
          locks: decision.locks.map((l) => l.target),
          signals: signals.map((s) => ({ type: s.type, severity: s.severity })),
        },
      });
      await this.notifications.notifyAlert(alert.id);
    } catch (error) {
      this.source = null; // retry the lookup next time
      this.logger.error(
        `Could not raise an alert for login attempt ${attempt.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
