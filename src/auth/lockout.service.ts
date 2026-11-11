import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, MoreThan, MoreThanOrEqual, Repository } from 'typeorm';
import {
  LOGIN_RULES,
  lockoutMinutes,
  type LockTargetType,
  type LoginSignalType,
} from './detection/login-rules.js';
import { Lockout } from './entities/lockout.entity.js';

@Injectable()
export class LockoutService {
  constructor(@InjectRepository(Lockout) private readonly lockouts: Repository<Lockout>) {}

  /** The active lockout for any of these targets (email / IP), if one exists. */
  findActive(targets: string[], now: Date): Promise<Lockout | null> {
    return this.lockouts.findOne({
      where: { target: In(targets), lockedUntil: MoreThan(now) },
      order: { lockedUntil: 'DESC' },
    });
  }

  /** Rule 7: did a lockout for any of these targets end in the last few seconds? */
  endedRecently(targets: string[], now: Date): Promise<boolean> {
    const since = new Date(now.getTime() - LOGIN_RULES.postLockout.graceSeconds * 1000);
    return this.lockouts.exists({
      where: { target: In(targets), lockedUntil: Between(since, now) },
    });
  }

  /**
   * Locks a target. Each earlier lockout of the same target in the last 24h
   * doubles the length (15 -> 30 -> 60 min ...), capped at 24h.
   */
  async lock(
    targetType: LockTargetType,
    target: string,
    ip: string,
    reason: LoginSignalType,
    baseMinutes: number,
    now: Date,
  ): Promise<Lockout> {
    const { lookbackHours } = LOGIN_RULES.lockoutEscalation;
    const previous = await this.lockouts.count({
      where: { target, createdAt: MoreThanOrEqual(new Date(now.getTime() - lookbackHours * 3600_000)) },
    });
    const minutes = lockoutMinutes(baseMinutes, previous);
    return this.lockouts.save(
      this.lockouts.create({
        targetType,
        target,
        ip,
        reason,
        lockedUntil: new Date(now.getTime() + minutes * 60_000),
      }),
    );
  }
}
