import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { DevicesService } from './devices.service.js';

/**
 * SPECS.md section 8: any logged-in user manages only their own devices.
 * Authentication comes from the global JwtAuthGuard.
 */
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  findMine(@CurrentUser() user: AuthUser) {
    return this.devices.findForUser(user.id);
  }

  @Patch(':id/trust')
  trust(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.devices.trust(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.devices.revoke(user.id, id);
  }
}
