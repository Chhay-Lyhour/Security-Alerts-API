import type { AlertStatus } from '../entities/alert-status.enum.js';

export const ALERT_STATUS_CHANGED = 'alert.status_changed';

export class AlertStatusChangedEvent {
  constructor(
    public readonly alertId: string,
    public readonly userId: string,
    public readonly from: AlertStatus,
    public readonly to: AlertStatus,
  ) {}
}
