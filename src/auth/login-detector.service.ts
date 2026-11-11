import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { DevicesService } from '../devices/devices.service.js';
import { buildFingerprint } from '../devices/fingerprint.js';
import type { User } from '../users/entities/user.entity.js';
import {
  LOGIN_RULES,
  decideResponse,
  evaluateLoginRules,
  hourInTimeZone,
  scoreSignals,
  type DeviceStatus,
  type LoginDecision,
  type LoginFacts,
  type LoginSignal,
  type LoginSignalType,
  type RiskLevel,
} from './detection/login-rules.js';
import type { RequestContext } from './detection/request-context.js';
import { LoginAttempt } from './entities/login-attempt.entity.js';
import { LockoutService } from './lockout.service.js';

export interface LoginAssessment {
  signals: LoginSignal[];
  score: number;
  level: RiskLevel;
  decision: LoginDecision;
}

/** What AuthService should do after the attempt was recorded. */
export interface LoginVerdict {
  /** False when the password was wrong or detection denied the login. */
  issueToken: boolean;
  /** Rule 3 (possible compromise): end every session of this user. */
  revokeSessions: boolean;
}

export interface RecordAttemptInput {
  email: string;
  user: User | null;
  /** Password matched (and the user exists). */
  success: boolean;
  ctx: RequestContext;
}

type Scope = 'email' | 'ip' | 'userId';

/**
 * Window rules keep firing on every attempt once the threshold is passed.
 * Within the window, only the first attempt raises the signal.
 */
const REPEAT_WINDOWS: Partial<Record<LoginSignalType, { seconds: number; scope: Scope[] }>> = {
  brute_force: { seconds: LOGIN_RULES.bruteForce.windowSeconds, scope: ['email', 'ip'] },
  credential_stuffing: { seconds: LOGIN_RULES.credentialStuffing.windowSeconds, scope: ['ip'] },
  account_enumeration: { seconds: LOGIN_RULES.accountEnumeration.windowSeconds, scope: ['ip'] },
  rapid_logins: { seconds: LOGIN_RULES.rapidLogins.windowSeconds, scope: ['userId'] },
};

const TOO_MANY_ATTEMPTS = 'Too many login attempts. Please try again later.';

/**
 * Login detection (SPECS.md sections 4, 6 and 7). AuthService.login calls:
 *   1. assertNotLocked()  before checking the password
 *   2. recordAttempt()    after checking it
 * recordAttempt saves the LoginAttempt, runs the 9 rules
 * (Detect -> Score -> Protect) and updates the user's devices.
 */
@Injectable()
export class LoginDetectorService {
  private readonly logger = new Logger(LoginDetectorService.name);

  constructor(
    @InjectRepository(LoginAttempt) private readonly attempts: Repository<LoginAttempt>,
    private readonly lockouts: LockoutService,
    private readonly devices: DevicesService,
  ) {}

  /** Throws 429 (and records a blocked attempt) while the email or IP is locked. */
  async assertNotLocked(email: string, user: User | null, ctx: RequestContext): Promise<void> {
    const now = new Date();
    const normalized = normalizeEmail(email);
    if (!(await this.lockouts.findActive([normalized, ctx.ip], now))) return;

    await this.attempts.save(
      this.attempts.create({ ...this.baseAttempt(normalized, user, ctx), success: false, blocked: true }),
    );
    throw new HttpException(TOO_MANY_ATTEMPTS, HttpStatus.TOO_MANY_REQUESTS);
  }

  /** Records the attempt and runs the rules. Throws 429 when a rule locks the email/IP. */
  async recordAttempt({ email, user, success, ctx }: RecordAttemptInput): Promise<LoginVerdict> {
    const now = new Date();
    const normalized = normalizeEmail(email);
    const passwordOk = success && !!user;

    // Saved first, so the rules count this attempt too.
    const attempt = await this.attempts.save(
      this.attempts.create({ ...this.baseAttempt(normalized, user, ctx), success: passwordOk }),
    );

    const { fingerprint, name } = buildFingerprint(ctx.userAgent, ctx.deviceId);
    const deviceCheck = passwordOk ? await this.devices.classify(user!.id, fingerprint, now) : null;

    const assessment = await this.assess(attempt, user, deviceCheck?.status ?? null, now);
    await this.attempts.update(attempt.id, {
      signals: assessment.signals,
      riskScore: assessment.score,
      riskLevel: assessment.level,
    });
    this.report(attempt, assessment);

    // Protect.
    const { locks, denyToken } = assessment.decision;
    for (const lock of locks) {
      const target = lock.target === 'email' ? normalized : ctx.ip;
      await this.lockouts.lock(lock.target, target, ctx.ip, lock.reason, lock.baseMinutes, now);
    }
    if (locks.length) {
      throw new HttpException(TOO_MANY_ATTEMPTS, HttpStatus.TOO_MANY_REQUESTS);
    }

    const issueToken = passwordOk && !denyToken;
    if (issueToken) {
      // Only allowed logins make a device "known" (a blocked attacker's never does).
      await this.devices.recordLogin(user!.id, deviceCheck!, { fingerprint, name, ip: ctx.ip, country: ctx.country }, now);
    }
    return { issueToken, revokeSessions: passwordOk && denyToken };
  }

  /** Gathers facts from the database -> Detect -> Score -> Protect. */
  async assess(
    attempt: LoginAttempt,
    user: User | null,
    device: DeviceStatus | null,
    now: Date,
  ): Promise<LoginAssessment> {
    const facts = await this.gatherFacts(attempt, user, device, now);
    const signals = await this.dropRepeats(evaluateLoginRules(facts), attempt, now);
    const { score, level } = scoreSignals(signals);
    const decision = decideResponse(facts, level);
    return { signals, score, level, decision };
  }

  private baseAttempt(email: string, user: User | null, ctx: RequestContext) {
    return {
      userId: user?.id ?? null,
      email,
      ip: ctx.ip,
      country: ctx.country,
      deviceFingerprint: buildFingerprint(ctx.userAgent, ctx.deviceId).fingerprint,
      userAgent: ctx.userAgent,
      emailExists: !!user,
    };
  }

  /**
   * Until the Alerts module exists, detections are stored on the
   * LoginAttempt row and logged here. Later this is where each signal
   * becomes an Alert and a notification job.
   */
  private report(attempt: LoginAttempt, assessment: LoginAssessment): void {
    if (!assessment.signals.length) return;
    const types = assessment.signals
      .map((s) => (s.related?.length ? `${s.type}(+${s.related.join(',')})` : s.type))
      .join(', ');
    const line = `Login risk ${assessment.level.toUpperCase()} (score ${assessment.score}, action ${assessment.decision.action}) for ${attempt.email} from ${attempt.ip}: ${types}`;
    if (assessment.level === 'high' || assessment.level === 'critical') this.logger.warn(line);
    else this.logger.log(line);
  }

  private async gatherFacts(
    attempt: LoginAttempt,
    user: User | null,
    device: DeviceStatus | null,
    now: Date,
  ): Promise<LoginFacts> {
    const R = LOGIN_RULES;
    const since = (seconds: number) => MoreThanOrEqual(ago(now, seconds));

    const [failedForEmail, failedForIp, distinctEmailsFromIp, unknownEmailFailuresFromIp, lockoutJustExpired] =
      await Promise.all([
        this.attempts.count({
          where: { email: attempt.email, success: false, blocked: false, createdAt: since(R.bruteForce.windowSeconds) },
        }),
        this.attempts.count({
          where: { ip: attempt.ip, success: false, blocked: false, createdAt: since(R.bruteForce.windowSeconds) },
        }),
        this.countDistinctEmails(attempt.ip, ago(now, R.credentialStuffing.windowSeconds)),
        this.attempts.count({
          where: {
            ip: attempt.ip,
            success: false,
            emailExists: false,
            blocked: false,
            createdAt: since(R.accountEnumeration.windowSeconds),
          },
        }),
        this.lockouts.endedRecently([attempt.email, attempt.ip], now),
      ]);

    const facts: LoginFacts = {
      success: attempt.success,
      emailExists: attempt.emailExists,
      failedForEmail,
      failedForIp,
      distinctEmailsFromIp,
      unknownEmailFailuresFromIp,
      lockoutJustExpired,
      failedForUserRecent: 0,
      successesForUserRecent: 0,
      hasLoginHistory: false,
      device,
      countrySeenBefore: null,
      ipSeenBefore: true,
      loginsInLookback: 0,
      loginsThisHour: 0,
    };

    if (attempt.success && user) {
      Object.assign(facts, await this.gatherUserFacts(attempt, user, now));
    }
    return facts;
  }

  /** Facts about the user's own history, only needed for successful logins. */
  private async gatherUserFacts(attempt: LoginAttempt, user: User, now: Date): Promise<Partial<LoginFacts>> {
    const R = LOGIN_RULES;
    const earlierSuccess = { userId: user.id, success: true, id: Not(attempt.id) };

    const [failedForUserRecent, successesForUserRecent, hasLoginHistory, countrySeen, ipSeenBefore, hours] =
      await Promise.all([
        this.attempts.count({
          where: {
            userId: user.id,
            success: false,
            blocked: false,
            createdAt: MoreThanOrEqual(ago(now, R.possibleCompromise.windowSeconds)),
          },
        }),
        this.attempts.count({
          where: { userId: user.id, success: true, createdAt: MoreThanOrEqual(ago(now, R.rapidLogins.windowSeconds)) },
        }),
        this.attempts.exists({ where: earlierSuccess }),
        attempt.country
          ? this.attempts.exists({ where: { ...earlierSuccess, country: attempt.country } })
          : Promise.resolve(null),
        this.attempts.exists({ where: { ...earlierSuccess, ip: attempt.ip } }),
        this.hourStats(attempt, user, now),
      ]);

    return {
      failedForUserRecent,
      successesForUserRecent,
      hasLoginHistory,
      countrySeenBefore: countrySeen,
      ipSeenBefore,
      loginsInLookback: hours.total,
      loginsThisHour: hours.thisHour,
    };
  }

  /** Rule 9: successful logins in the last 30 days, and how many were at this hour. */
  private async hourStats(attempt: LoginAttempt, user: User, now: Date) {
    const timeZone = user.timezone ?? 'UTC';
    const row = await this.attempts
      .createQueryBuilder('a')
      .select('COUNT(*)', 'total')
      .addSelect(
        `COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM a."createdAt" AT TIME ZONE :timeZone) = :hour)`,
        'thisHour',
      )
      .where('a."userId" = :userId', { userId: user.id })
      .andWhere('a.success = true')
      .andWhere('a.id != :id', { id: attempt.id })
      .andWhere('a."createdAt" >= :since', { since: ago(now, LOGIN_RULES.unusualTime.lookbackDays * 86_400) })
      .setParameters({ timeZone, hour: hourInTimeZone(now, timeZone) })
      .getRawOne<{ total: string; thisHour: string }>();
    return { total: Number(row?.total ?? 0), thisHour: Number(row?.thisHour ?? 0) };
  }

  private async countDistinctEmails(ip: string, since: Date): Promise<number> {
    const row = await this.attempts
      .createQueryBuilder('a')
      .select('COUNT(DISTINCT a.email)', 'count')
      .where('a.ip = :ip', { ip })
      .andWhere('a.blocked = false')
      .andWhere('a."createdAt" >= :since', { since })
      .getRawOne<{ count: string }>();
    return Number(row?.count ?? 0);
  }

  private async dropRepeats(signals: LoginSignal[], attempt: LoginAttempt, now: Date): Promise<LoginSignal[]> {
    const kept = await Promise.all(
      signals.map(async (signal) => {
        const repeat = REPEAT_WINDOWS[signal.type];
        if (!repeat) return signal;
        const fired = await this.firedBefore(signal.type, repeat.scope, attempt, ago(now, repeat.seconds));
        return fired ? null : signal;
      }),
    );
    return kept.filter((s): s is LoginSignal => s !== null);
  }

  private firedBefore(type: LoginSignalType, scope: Scope[], attempt: LoginAttempt, since: Date): Promise<boolean> {
    const values: Record<Scope, string | null> = { email: attempt.email, ip: attempt.ip, userId: attempt.userId };
    const columns = scope.filter((s) => values[s] !== null);
    if (!columns.length) return Promise.resolve(false);

    return this.attempts
      .createQueryBuilder('a')
      .where('a.id != :id', { id: attempt.id })
      .andWhere('a."createdAt" >= :since', { since })
      .andWhere('a.signals @> CAST(:signal AS jsonb)', { signal: JSON.stringify([{ type }]) })
      .andWhere(
        new Brackets((qb) => {
          for (const column of columns) {
            qb.orWhere(`a."${column}" = :${column}`, { [column]: values[column] });
          }
        }),
      )
      .getExists();
  }
}

function ago(now: Date, seconds: number): Date {
  return new Date(now.getTime() - seconds * 1000);
}

/** Same normalisation as UsersService, so attempts match the stored email. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
