import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { randomToken, sha256Hex } from '../common/crypto.util.js';
import { RefreshToken } from './entities/refresh-token.entity.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const INVALID_REFRESH_TOKEN = 'Invalid refresh token';

@Injectable()
export class RefreshTokensService {
  private readonly logger = new Logger(RefreshTokensService.name);
  private readonly ttlMs: number;

  constructor(
    @InjectRepository(RefreshToken)
    private readonly tokens: Repository<RefreshToken>,
    config: ConfigService,
  ) {
    this.ttlMs = Number(config.get('REFRESH_TOKEN_TTL_DAYS', 7)) * DAY_MS;
  }

  /** Issues a token. Pass a familyId to continue a session; omit it to start one. */
  async issue(userId: string, familyId: string = randomUUID()): Promise<string> {
    const rawToken = randomToken('rt_');
    await this.tokens.insert({
      userId,
      familyId,
      tokenHash: sha256Hex(rawToken),
      expiresAt: new Date(Date.now() + this.ttlMs),
      usedAt: null,
      revokedAt: null,
    });
    return rawToken;
  }

  /**
   * Spends a refresh token and returns a new one from the same session.
   * The conditional UPDATE means only one of two concurrent calls with the
   * same token can win, so a token can never be spent twice.
   */
  async rotate(rawToken: string): Promise<{ userId: string; refreshToken: string }> {
    const token = await this.tokens.findOne({
      where: { tokenHash: sha256Hex(rawToken) },
    });
    if (!token) throw new UnauthorizedException(INVALID_REFRESH_TOKEN);

    const spent = await this.tokens.update(
      {
        id: token.id,
        usedAt: IsNull(),
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      { usedAt: new Date() },
    );

    if (spent.affected !== 1) {
      if (token.usedAt) await this.handleReuse(token);
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    return {
      userId: token.userId,
      refreshToken: await this.issue(token.userId, token.familyId),
    };
  }

  /** Logout: ends the session the token belongs to. Unknown tokens are ignored. */
  async revokeSession(rawToken: string): Promise<void> {
    const token = await this.tokens.findOne({
      where: { tokenHash: sha256Hex(rawToken) },
    });
    if (!token) return;
    await this.tokens.update(
      { familyId: token.familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /** Ends every session for a user, e.g. after a suspected compromise. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.tokens.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private async handleReuse(token: RefreshToken): Promise<void> {
    this.logger.warn(
      `Refresh token reuse for user=${token.userId} family=${token.familyId}; revoking all sessions`,
    );
    await this.revokeAllForUser(token.userId);
  }
}
