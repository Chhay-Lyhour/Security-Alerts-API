import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { AlertSeverity } from '../../alerts/entities/alert-severity.enum.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateAlertRuleDto {
    @IsOptional()
    @Transform(trim)
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    name?: string;

    @IsOptional()
    @Transform(trim)
    @IsString()
    @MaxLength(64)
    @Matches(/^[a-z][a-z0-9_]*$/, { message: 'type must be snake_case, e.g. failed_login' })
    type?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    threshold?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(86400)
    windowSeconds?: number;

    @IsOptional()
    @IsEnum(AlertSeverity)
    severity?: AlertSeverity;

    @IsOptional()
    @IsBoolean()
    isEnabled?: boolean;
}
