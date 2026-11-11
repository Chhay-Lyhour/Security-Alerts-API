import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../common/types/auth-user.type.js';
import type { User } from '../users/entities/user.entity.js';
import { hashPassword, verifyPassword } from '../users/password.util.js';
import { UsersService } from '../users/users.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { RefreshTokensService } from './refresh-tokens.service.js';

export type AuthResponse = {
  tokenType: 'Bearer';
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  refreshToken: string;
  user: Pick<User, 'id' | 'email' | 'role' | 'timezone' | 'createdAt'>;
};

const INVALID_CREDENTIALS = 'Invalid credentials';

@Injectable()
export class AuthService {
  // Verified against when the email is unknown, so a missing account takes
  // as long to reject as a wrong password (no timing-based enumeration).
  private readonly dummyHash = hashPassword('dummy-password-for-timing');
  private readonly accessTtlSeconds: number;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly refreshTokens: RefreshTokensService,
    config: ConfigService,
  ) {
    this.accessTtlSeconds = Number(
      config.get('JWT_ACCESS_EXPIRES_IN_SECONDS', 900),
    );
  }

  async register(dto: RegisterDto): Promise<AuthResponse> {
    if (await this.usersService.findByEmail(dto.email)) {
      throw new ConflictException('Email already registered');
    }
    const user = await this.usersService.create({
      email: dto.email,
      password: dto.password,
      timezone: dto.timezone,
    });
    return this.buildResponse(user, await this.refreshTokens.issue(user.id));
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    const passwordMatches = await verifyPassword(
      user?.passwordHash ?? (await this.dummyHash),
      dto.password,
    );
    if (!user || !passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    return this.buildResponse(user, await this.refreshTokens.issue(user.id));
  }

  async refresh(rawRefreshToken: string): Promise<AuthResponse> {
    const { userId, refreshToken } =
      await this.refreshTokens.rotate(rawRefreshToken);
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('Invalid refresh token');
    return this.buildResponse(user, refreshToken);
  }

  logout(rawRefreshToken: string): Promise<void> {
    return this.refreshTokens.revokeSession(rawRefreshToken);
  }

  private async buildResponse(
    user: User,
    refreshToken: string,
  ): Promise<AuthResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return {
      tokenType: 'Bearer',
      accessToken: await this.jwtService.signAsync(payload),
      expiresIn: this.accessTtlSeconds,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        timezone: user.timezone,
        createdAt: user.createdAt,
      },
    };
  }
}
