import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type FindOptionsWhere, MoreThan, Not, Repository } from 'typeorm';
import type { Paginated } from '../alerts/alerts.service.js';
import {
  LOGIN_RULES,
  type RiskLevel,
  SCORE_THRESHOLDS,
  SEVERITY_WEIGHTS,
} from './detection/login-rules.js';
import type { QueryLoginAttemptsDto } from './dto/query-login-attempts.dto.js';
import { Lockout } from './entities/lockout.entity.js';
import { LoginAttempt } from './entities/login-attempt.entity.js';

/** A login attempt as the dashboard sees it: no device fingerprint. */
export type LoginAttemptView = Omit<LoginAttempt, 'deviceFingerprint' | 'user'>;

/**
 * Read side of login detection, for analysts: what the 9 rules saw (Detect),
 * how each attempt was scored (Score) and which emails/IPs are locked
 * (Protect). The write side stays in LoginDetectorService.
 */
@Injectable()
export class LoginInsightsService {
  constructor(
    @InjectRepository(LoginAttempt)
    private readonly attempts: Repository<LoginAttempt>,
    @InjectRepository(Lockout) private readonly lockouts: Repository<Lockout>,
  ) {}

  async findAttempts(
    query: QueryLoginAttemptsDto,
  ): Promise<Paginated<LoginAttemptView>> {
    const { page, limit } = query;
    const base: FindOptionsWhere<LoginAttempt> = {};
    if (query.riskLevel) base.riskLevel = query.riskLevel;
    if (query.ip) base.ip = query.ip;
    if (query.email) base.email = query.email.trim().toLowerCase();

    // "Flagged" = a rule fired (risk level above none) or a lockout refused it.
    let where:
      FindOptionsWhere<LoginAttempt> | FindOptionsWhere<LoginAttempt>[] = base;
    if (query.flagged && !query.riskLevel) {
      where = [
        { ...base, riskLevel: Not<RiskLevel>('none') },
        { ...base, blocked: true },
      ];
    } else if (query.flagged && query.riskLevel === 'none') {
      where = { ...base, blocked: true };
    }

    const [rows, total] = await this.attempts.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const data = rows.map(
      ({ deviceFingerprint: _fp, user: _user, ...rest }) => rest,
    );
    return { data, total, page, limit };
  }

  /** Lockouts still in force, soonest to end last. */
  activeLockouts(now = new Date()): Promise<Lockout[]> {
    return this.lockouts.find({
      where: { lockedUntil: MoreThan(now) },
      order: { lockedUntil: 'DESC' },
    });
  }

  /**
   * Ends a lockout now. The row is kept (lockedUntil moves to now) so the
   * history still doubles the next lockout of the same target.
   */
  async liftLockout(id: string, now = new Date()): Promise<Lockout> {
    const lockout = await this.lockouts.findOne({ where: { id } });
    if (!lockout) throw new NotFoundException('Lockout not found');
    if (lockout.lockedUntil > now) {
      lockout.lockedUntil = now;
      await this.lockouts.save(lockout);
    }
    return lockout;
  }

  /** The thresholds and weights the rules run with, so the dashboard can explain a score. */
  config() {
    return {
      rules: LOGIN_RULES,
      severityWeights: SEVERITY_WEIGHTS,
      scoreThresholds: Object.fromEntries(SCORE_THRESHOLDS),
    };
  }
}
