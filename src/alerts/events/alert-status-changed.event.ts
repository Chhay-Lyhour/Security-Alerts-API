import type { AlertStatus } from '../entities/alert-status.enum.js';

export const ALERT_STATUS_CHANGED = 'alert.status_changed';

/** Fired when an analyst or admin changes an alert's status. The audit log (build step 5) records it. */
export class AlertStatusChangedEvent {
  constructor(
    public readonly alertId: string,
    public readonly userId: string,
    public readonly from: AlertStatus,
    public readonly to: AlertStatus,
  ) {}
}
