import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { AlertSeverity } from '../../alerts/entities/alert-severity.enum.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateAlertRuleDto {
    @Transform(trim)
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    name: string;

    // Alert type to count; same snake_case format as CreateAlertDto.type.
    @Transform(trim)
    @IsString()
    @MaxLength(64)
    @Matches(/^[a-z][a-z0-9_]*$/, { message: 'type must be snake_case, e.g. failed_login' })
    type: string;

    @IsInt()
    @Min(1)
    threshold: number;

    @IsInt()
    @Min(1)
    @Max(86400)
    windowSeconds: number;

    @IsEnum(AlertSeverity)
    severity: AlertSeverity;

    @IsOptional()
    @IsBoolean()
    isEnabled: boolean = true;
}
