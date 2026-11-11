import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeyGuard } from '../common/guards/api-key.guard.js';
import { Source } from './entities/source.entity.js';
import { SourcesService } from './sources.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Source])],
  providers: [SourcesService, ApiKeyGuard],
  exports: [SourcesService, ApiKeyGuard],
})
export class SourcesModule {}
