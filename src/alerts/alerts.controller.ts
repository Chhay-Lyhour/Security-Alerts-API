import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ApiKeyGuard } from '../common/guards/api-key.guard.js';
import { UserRole } from '../users/entities/user-role.enum.js';
import { AlertsService } from './alerts.service.js';
import { CreateAlertDto } from './dto/create-alert.dto.js';
import { QueryAlertsDto } from './dto/query-alerts.dto.js';
import { UpdateAlertStatusDto } from './dto/update-alert-status.dto.js';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Public()
  @UseGuards(ApiKeyGuard)
  @Post()
  ingest(@Req() req: Request, @Body() dto: CreateAlertDto) {
    return this.alertsService.ingest(req.source!, dto);
  }
  
  @Get()
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  findAll(@Query() query: QueryAlertsDto) {
    return this.alertsService.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.alertsService.findOne(id);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.ANALYST)
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAlertStatusDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.alertsService.updateStatus(id, dto.status, userId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.alertsService.remove(id);
  }
}
