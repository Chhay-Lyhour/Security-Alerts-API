import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsIP,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { RiskLevel } from '../detection/login-rules.js';

const RISK_LEVELS: RiskLevel[] = ['none', 'low', 'medium', 'high', 'critical'];

/** Filters for GET /detection/login-attempts. Results are newest first. */
export class QueryLoginAttemptsDto {
  @IsOptional()
  @IsIn(RISK_LEVELS)
  riskLevel?: RiskLevel;

  /** true: only attempts where at least one rule fired, or that a lockout refused. */
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  flagged?: boolean;

  @IsOptional()
  @IsIP()
  ip?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
