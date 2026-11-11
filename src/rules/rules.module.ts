import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts/alerts.module.js';
import { Alert } from '../alerts/entities/alert.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AlertRule } from './entities/alert-rule.entity.js';
import { RuleEngineService } from './rule-engine.service.js';
import { RulesController } from './rules.controller.js';
import { RulesService } from './rules.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([AlertRule, Alert]),
    AlertsModule,
    NotificationsModule,
  ],
  controllers: [RulesController],
  providers: [RulesService, RuleEngineService],
  exports: [RulesService, RuleEngineService],
})
export class RulesModule {}
