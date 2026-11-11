import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIP,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { AlertSeverity } from '../entities/alert-severity.enum.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateAlertDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsEnum(AlertSeverity)
  severity: AlertSeverity;

  /** snake_case, e.g. `failed_login`, `port_scan`, `permission_change`. */
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'type must be snake_case, e.g. failed_login',
  })
  type: string;

  @IsOptional()
  @IsIP()
  ipAddress?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
