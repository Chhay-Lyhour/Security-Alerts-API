import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert } from '../alerts/entities/alert.entity.js';
import { AuditModule } from '../audit/audit.module.js';
import { SourcesModule } from '../sources/sources.module.js';
import { AutoBlockListener } from './auto-block.listener.js';
import { BlockedIp } from './entities/blocked-ip.entity.js';
import { FirewallController } from './firewall.controller.js';
import { FirewallMiddleware } from './firewall.middleware.js';
import { FirewallService } from './firewall.service.js';

/**
 * IP filter in front of the whole API, plus the same blocklist offered to
 * integrated apps (POST /firewall/check) so they can enforce it at their
 * own edge.
 */
@Module({
  // SourcesModule provides the ApiKeyGuard used on POST /firewall/check.
  imports: [
    TypeOrmModule.forFeature([BlockedIp, Alert]),
    SourcesModule,
    AuditModule,
  ],
  controllers: [FirewallController],
  providers: [FirewallService, AutoBlockListener],
  exports: [FirewallService],
})
export class FirewallModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(FirewallMiddleware).forRoutes('*');
  }
}
