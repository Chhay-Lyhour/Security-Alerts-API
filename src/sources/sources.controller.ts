import { Body, Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../users/entities/user-role.enum.js';
import { CreateSourceDto } from './dto/create-source.dto.js';
import { SourcesService } from './sources.service.js';

/** Admins register the external systems that are allowed to send alerts. */
@Controller('sources')
@Roles(UserRole.ADMIN)
export class SourcesController {
  constructor(private readonly sourcesService: SourcesService) {}

  /** Returns the new source with its API key. The key is never shown again. */
  @Post()
  create(@Body() dto: CreateSourceDto) {
    return this.sourcesService.create(dto);
  }

  @Get()
  findAll() {
    return this.sourcesService.findAll();
  }
}
