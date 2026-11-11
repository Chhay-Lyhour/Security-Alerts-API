import { Body, Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../users/entities/user-role.enum.js';
import { CreateSourceDto } from './dto/create-source.dto.js';
import { SourcesService } from './sources.service.js';

@Controller('sources')
@Roles(UserRole.ADMIN)
export class SourcesController {
  constructor(private readonly sourcesService: SourcesService) {}

  @Post()
  create(@Body() dto: CreateSourceDto) {
    return this.sourcesService.create(dto);
  }

  @Get()
  findAll() {
    return this.sourcesService.findAll();
  }
}
