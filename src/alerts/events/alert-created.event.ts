import type { AlertSeverity } from '../entities/alert-severity.enum.js';

export const ALERT_CREATED = 'alert.created';

export class AlertCreatedEvent {
  constructor(
    public readonly alertId: string,
    public readonly type: string,
    public readonly severity: AlertSeverity,
    public readonly ipAddress: string | null,
  ) {}
}
