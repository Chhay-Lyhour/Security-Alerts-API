import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../users/entities/user-role.enum.js';
import { QueryLoginAttemptsDto } from './dto/query-login-attempts.dto.js';
import { LoginInsightsService } from './login-insights.service.js';

/** What the login detection engine saw, scored and locked. */
@Controller('detection')
@Roles(UserRole.ADMIN, UserRole.ANALYST)
export class LoginInsightsController {
  constructor(private readonly insights: LoginInsightsService) {}

  @Get('login-attempts')
  attempts(@Query() query: QueryLoginAttemptsDto) {
    return this.insights.findAttempts(query);
  }

  @Get('lockouts')
  lockouts() {
    return this.insights.activeLockouts();
  }

  @Get('config')
  config() {
    return this.insights.config();
  }

  /** Lifting a lockout is privileged: admins only, and audited. */
  @Roles(UserRole.ADMIN)
  @Delete('lockouts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async lift(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.insights.liftLockout(id);
  }
}
