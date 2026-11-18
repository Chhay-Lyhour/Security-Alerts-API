import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsTimeZone,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '../entities/user-role.enum.js';

/** Body of POST /users. Only admins create accounts. */
export class CreateUserDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  // The upper bound caps hashing cost per request; Argon2 itself has no limit.
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password: string;

  /** Defaults to analyst: least privilege unless an admin asks for more. */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}
