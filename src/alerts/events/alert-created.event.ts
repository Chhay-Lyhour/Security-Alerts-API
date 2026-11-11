import type { Alert } from '../entities/alert.entity.js';

export const ALERT_CREATED = 'alert.created';

/**
 * Fired after an alert is saved. The rule engine (build step 4) listens for it
 * to check thresholds; nothing in the ingest request waits on listeners.
 */
export class AlertCreatedEvent {
  constructor(public readonly alert: Alert) {}
}
