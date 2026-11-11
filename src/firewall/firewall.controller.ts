import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { getRequestContext } from '../auth/detection/request-context.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ApiKeyGuard } from '../common/guards/api-key.guard.js';
import { UserRole } from '../users/entities/user-role.enum.js';
import { CheckIpDto } from './dto/check-ip.dto.js';
import { CreateBlockedIpDto } from './dto/create-blocked-ip.dto.js';
import { BlockOrigin } from './entities/block-origin.enum.js';
import { FirewallService } from './firewall.service.js';

@Controller('firewall')
export class FirewallController {
  constructor(private readonly firewall: FirewallService) {}

  /**
   * Firewall as a service: an integrated app (it authenticates with its
   * source API key) asks whether a visitor's IP is blocked before letting
   * them log in.
   */
  @Public()
  @UseGuards(ApiKeyGuard)
  @Post('check')
  @HttpCode(HttpStatus.OK)
  check(@Body() dto: CheckIpDto) {
    const { ip, blocked, reason, expiresAt } = this.firewall.check(dto.ip);
    return { ip, blocked, reason, expiresAt };
  }

  @Roles(UserRole.ADMIN)
  @Post('blocked-ips')
  block(
    @Body() dto: CreateBlockedIpDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.firewall.block(
      {
        ip: dto.ip,
        reason: dto.reason,
        expiresInMinutes: dto.expiresInMinutes,
        origin: BlockOrigin.MANUAL,
        createdBy: userId,
      },
      getRequestContext(req).ip,
    );
  }

  @Roles(UserRole.ADMIN)
  @Get('blocked-ips')
  list() {
    return this.firewall.list();
  }

  @Roles(UserRole.ADMIN)
  @Delete('blocked-ips/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  unblock(@Param('id', ParseUUIDPipe) id: string) {
    return this.firewall.unblock(id);
  }
}
