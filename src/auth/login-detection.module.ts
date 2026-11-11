import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevicesModule } from '../devices/devices.module.js';
import { Lockout } from './entities/lockout.entity.js';
import { LoginAttempt } from './entities/login-attempt.entity.js';
import { LockoutService } from './lockout.service.js';
import { LoginDetectorService } from './login-detector.service.js';

/**
 * Login detection (Person 4). Kept in its own module so AuthModule only has
 * to import it; AuthService calls LoginDetectorService on every login.
 * Importing it also registers DevicesModule (the /devices routes).
 */
@Module({
  imports: [TypeOrmModule.forFeature([LoginAttempt, Lockout]), DevicesModule],
  providers: [LoginDetectorService, LockoutService],
  exports: [LoginDetectorService],
})
export class LoginDetectionModule {}
