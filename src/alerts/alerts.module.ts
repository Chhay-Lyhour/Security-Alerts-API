import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SourcesModule } from '../sources/sources.module.js';
import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';
import { Alert } from './entities/alert.entity.js';
import { AlertCreatedListener } from './listeners/alert-created.listener.js';

@Module({
  // SourcesModule provides the ApiKeyGuard used on POST /alerts.
  imports: [TypeOrmModule.forFeature([Alert]), SourcesModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertCreatedListener],
  exports: [AlertsService],
})
export class AlertsModule {}
