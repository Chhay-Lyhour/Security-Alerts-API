import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../users/entities/user-role.enum.js';
import { RulesService } from './rules.service.js';
import { CreateAlertRuleDto } from './dto/create-alert-rule.dto.js';
import { UpdateAlertRuleDto } from './dto/update-alert-rule.dto.js';

@Roles(UserRole.ADMIN)
@Controller('rules')
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  @Post()
  create(@Body() dto: CreateAlertRuleDto) {
    return this.rulesService.create(dto);
  }

  @Get()
  findAll() {
    return this.rulesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.rulesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAlertRuleDto) {
    return this.rulesService.update(id, dto);
  }
}
