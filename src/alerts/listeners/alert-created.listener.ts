import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ALERT_CREATED,
  AlertCreatedEvent,
} from '../events/alert-created.event.js';

/**
 * Placeholder subscriber so the event is visible in the logs. The rule engine
 * in role 3 replaces it with real threshold checks.
 */
@Injectable()
export class AlertCreatedListener {
  private readonly logger = new Logger(AlertCreatedListener.name);

  @OnEvent(ALERT_CREATED, { async: true })
  handle(event: AlertCreatedEvent): void {
    this.logger.log(
      `${ALERT_CREATED}: id=${event.alertId} severity=${event.severity} type=${event.type} ip=${event.ipAddress ?? '-'}`,
    );
  }
}
