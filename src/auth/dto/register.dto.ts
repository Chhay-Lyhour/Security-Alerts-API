import {
  IsEmail,
  IsOptional,
  IsString,
  IsTimeZone,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  // The upper bound caps hashing cost per request; Argon2 itself has no limit.
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password: string;

  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}
