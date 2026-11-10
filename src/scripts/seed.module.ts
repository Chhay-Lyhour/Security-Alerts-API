import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmOptions } from '../config/typeorm.config.js';
import { UsersModule } from '../users/users.module.js';

/**
 * Only what the seed scripts need: config, the database and users. No HTTP
 * server, Redis or JWT, so it runs without the full API config.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      // Fail fast instead of retrying for ~30s when the database is down.
      useFactory: (config: ConfigService) => ({
        ...typeOrmOptions(config),
        retryAttempts: 0,
      }),
    }),
    UsersModule,
  ],
})
export class SeedModule {}
