import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { AuthService } from './auth.service.js';
import { getRequestContext } from './detection/request-context.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { RegisterDto } from './dto/register.dto.js';

const MINUTE_MS = 60_000;

/**
 * Rate limits are per client IP and per route, and answer 429 with a
 * Retry-After header. They are scoped to this controller rather than global:
 * a global limiter would answer 429 on hidden routes, revealing that they
 * exist. Per-account lockout comes later with login detection (rule 1).
 */
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: MINUTE_MS } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: MINUTE_MS } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, getRequestContext(req));
  }

  /** Swaps a refresh token for a new access + refresh token pair. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: MINUTE_MS } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  /**
   * Ends the session the refresh token belongs to. Public because the refresh
   * token is the credential, and logout should still work after the access
   * token has expired.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: MINUTE_MS } })
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
