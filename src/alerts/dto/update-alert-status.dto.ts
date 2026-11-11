import { IsIn } from 'class-validator';
import { AlertStatus } from '../entities/alert-status.enum.js';

export const SETTABLE_STATUSES = [
  AlertStatus.ACKNOWLEDGED,
  AlertStatus.RESOLVED,
] as const;

export class UpdateAlertStatusDto {
  @IsIn(SETTABLE_STATUSES, {
    message: `status must be one of: ${SETTABLE_STATUSES.join(', ')}`,
  })
  status: AlertStatus.ACKNOWLEDGED | AlertStatus.RESOLVED;
}
