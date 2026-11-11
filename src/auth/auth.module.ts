import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { JwtStrategy } from './jwt.strategy.js';
import { LoginDetectionModule } from './login-detection.module.js';
import { RefreshTokensService } from './refresh-tokens.service.js';

@Module({
  imports: [
    UsersModule,
    LoginDetectionModule,
    TypeOrmModule.forFeature([RefreshToken]),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: Number(config.get('JWT_ACCESS_EXPIRES_IN_SECONDS', 900)),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RefreshTokensService],
  // Exported so login detection (rule 3) can revoke sessions later.
  exports: [RefreshTokensService],
})
export class AuthModule {}
