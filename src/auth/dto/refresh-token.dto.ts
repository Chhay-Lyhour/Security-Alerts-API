import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  refreshToken: string;
}
