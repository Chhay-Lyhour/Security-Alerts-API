import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts/alerts.module.js';
import { DevicesModule } from '../devices/devices.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SourcesModule } from '../sources/sources.module.js';
import { Lockout } from './entities/lockout.entity.js';
import { LoginAttempt } from './entities/login-attempt.entity.js';
import { LockoutService } from './lockout.service.js';
import { LoginAlertsService } from './login-alerts.service.js';
import { LoginDetectorService } from './login-detector.service.js';
import { LoginInsightsController } from './login-insights.controller.js';
import { LoginInsightsService } from './login-insights.service.js';

/**
 * Login detection (Person 4). Kept in its own module so AuthModule only has
 * to import it; AuthService calls LoginDetectorService on every login.
 * Importing it also registers DevicesModule (the /devices routes) and the
 * read-only /detection routes the dashboard uses.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([LoginAttempt, Lockout]),
    DevicesModule,
    AlertsModule,
    SourcesModule,
    NotificationsModule,
  ],
  controllers: [LoginInsightsController],
  providers: [LoginDetectorService, LockoutService, LoginInsightsService, LoginAlertsService],
  exports: [LoginDetectorService],
})
export class LoginDetectionModule {}
