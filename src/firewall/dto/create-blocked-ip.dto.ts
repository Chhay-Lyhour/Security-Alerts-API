import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateBlockedIpDto {
  /** A single IP (`203.0.113.7`) or a CIDR range (`203.0.113.0/24`). Checked in FirewallService. */
  @IsString()
  @MinLength(2)
  @MaxLength(49)
  ip: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  /** Leave out for a permanent block. At most one year. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(525_600)
  expiresInMinutes?: number;
}
