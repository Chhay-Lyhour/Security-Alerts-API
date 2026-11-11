/**
 * Login detection: Detect -> Score -> Protect.
 *
 * Everything in this file is pure (no database, no clock), so it can be unit
 * tested on its own. `LoginDetectorService` gathers the facts from the
 * database and calls these functions.
 *
 * Rule numbers and thresholds follow SPECS.md section 7. Device behaviour
 * (returning device, new device escalation) follows SPECS.md section 6.
 */

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type RiskLevel = 'none' | Severity;

export type LoginSignalType =
  | 'brute_force'
  | 'new_device'
  | 'new_country'
  | 'possible_compromise'
  | 'credential_stuffing'
  | 'account_enumeration'
  | 'rapid_logins'
  | 'post_lockout_attempt'
  | 'new_ip'
  | 'unusual_time'
  | 'returning_device';

export type DeviceStatus = 'same' | 'returning' | 'new';
export type LockTargetType = 'email' | 'ip';

/**
 * Thresholds for every rule. SPECS.md says these should eventually live in
 * the AlertRule table so they can be tuned without a deploy; until that table
 * exists they live here.
 */
export const LOGIN_RULES = {
  bruteForce: { threshold: 20, windowSeconds: 60, lockMinutes: 15 },
  possibleCompromise: { threshold: 5, windowSeconds: 10 * 60 },
  credentialStuffing: { threshold: 10, windowSeconds: 10 * 60, lockMinutes: 15 },
  accountEnumeration: { threshold: 5, windowSeconds: 10 * 60 },
  rapidLogins: { threshold: 5, windowSeconds: 60 },
  postLockout: { graceSeconds: 30 },
  unusualTime: { lookbackDays: 30, minLogins: 10 },
  returningDevice: { inactiveDays: 30 },
  /** Each repeat lockout of the same target within this period doubles the duration. */
  lockoutEscalation: { lookbackHours: 24, maxMinutes: 24 * 60 },
} as const;

export type LoginRulesConfig = typeof LOGIN_RULES;

/** Weights used to turn fired rules into one risk score (slides: Stage 02). */
export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  low: 10,
  medium: 25,
  high: 50,
  critical: 100,
};

/** Minimum score for each level, highest first. Two LOW signals (20) reach MEDIUM. */
export const SCORE_THRESHOLDS: ReadonlyArray<[Severity, number]> = [
  ['critical', 100],
  ['high', 50],
  ['medium', 20],
  ['low', 1],
];

/** Everything the rules need to know about one login attempt. */
export interface LoginFacts {
  success: boolean;
  emailExists: boolean;

  // Counted for every attempt (the current attempt is included).
  failedForEmail: number; // rule 1 window
  failedForIp: number; // rule 1 window
  distinctEmailsFromIp: number; // rule 4 window
  unknownEmailFailuresFromIp: number; // rule 5 window
  lockoutJustExpired: boolean; // rule 7

  // Only meaningful when success = true (the current attempt is excluded).
  failedForUserRecent: number; // rule 3 window
  successesForUserRecent: number; // rule 6 window, current attempt included
  hasLoginHistory: boolean; // at least one earlier successful login
  device: DeviceStatus | null;
  /** null when the country is unknown. */
  countrySeenBefore: boolean | null;
  ipSeenBefore: boolean;
  loginsInLookback: number; // rule 9
  loginsThisHour: number; // rule 9, in the user's timezone
}

export interface LoginSignal {
  rule: number; // SPECS.md section 7 rule number (0 = section 6 only)
  type: LoginSignalType;
  severity: Severity;
  message: string;
  /** Other signals folded into this one so they raise a single alert. */
  related?: LoginSignalType[];
}

export interface LockAction {
  target: LockTargetType;
  reason: LoginSignalType;
  baseMinutes: number;
}

export type LoginAction = 'allow' | 'allow_and_alert' | 'block' | 'deny';

export interface LoginDecision {
  action: LoginAction;
  /** Lockouts to create. Non-empty means the request is answered with 429. */
  locks: LockAction[];
  /** Correct password, but no token is issued (critical risk). */
  denyToken: boolean;
}

// ---------------------------------------------------------------------------
// Stage 01: Detect
// ---------------------------------------------------------------------------

export function evaluateLoginRules(
  f: LoginFacts,
  rules: LoginRulesConfig = LOGIN_RULES,
): LoginSignal[] {
  const signals: LoginSignal[] = [];

  // Rule 1: brute force on one email or from one IP.
  const bf = rules.bruteForce;
  if (!f.success && (f.failedForEmail >= bf.threshold || f.failedForIp >= bf.threshold)) {
    const parts: string[] = [];
    if (f.failedForEmail >= bf.threshold) parts.push(`${f.failedForEmail} for this email`);
    if (f.failedForIp >= bf.threshold) parts.push(`${f.failedForIp} from this IP`);
    signals.push({
      rule: 1,
      type: 'brute_force',
      severity: 'high',
      message: `Brute force: ${parts.join(' and ')} failed logins in ${bf.windowSeconds}s`,
    });
  }

  // Rule 4: credential stuffing, many distinct emails from one IP.
  const cs = rules.credentialStuffing;
  if (f.distinctEmailsFromIp >= cs.threshold) {
    signals.push({
      rule: 4,
      type: 'credential_stuffing',
      severity: 'high',
      message: `Credential stuffing: ${f.distinctEmailsFromIp} different emails tried from this IP in ${minutes(cs.windowSeconds)}`,
    });
  }

  // Rule 5: account enumeration, failures on emails that do not exist.
  const ae = rules.accountEnumeration;
  if (!f.success && !f.emailExists && f.unknownEmailFailuresFromIp >= ae.threshold) {
    signals.push({
      rule: 5,
      type: 'account_enumeration',
      severity: 'medium',
      message: `Account enumeration: ${f.unknownEmailFailuresFromIp} logins for non-existent emails from this IP in ${minutes(ae.windowSeconds)}`,
    });
  }

  // Rule 7: an attempt right after a lockout ended.
  if (f.lockoutJustExpired) {
    signals.push({
      rule: 7,
      type: 'post_lockout_attempt',
      severity: 'medium',
      message: `Login attempt within ${rules.postLockout.graceSeconds}s of a lockout ending`,
    });
  }

  if (f.success) {
    signals.push(...evaluateSuccessRules(f, rules));
  }

  return signals;
}

function evaluateSuccessRules(f: LoginFacts, rules: LoginRulesConfig): LoginSignal[] {
  const signals: LoginSignal[] = [];

  // A user's very first login is their baseline, so "new" rules need history.
  const newDevice = f.hasLoginHistory && f.device === 'new';
  const newCountry = f.hasLoginHistory && f.countrySeenBefore === false;
  const newIp = f.hasLoginHistory && !f.ipSeenBefore;

  const placeTypes: LoginSignalType[] = [];
  if (newDevice) placeTypes.push('new_device');
  if (newCountry) placeTypes.push('new_country');

  const pc = rules.possibleCompromise;
  if (f.failedForUserRecent >= pc.threshold) {
    // Rule 3. Stays critical when the device/country is also new; the note says so.
    const related = [...placeTypes, ...(newIp ? (['new_ip'] as const) : [])];
    const extra = placeTypes.length
      ? ` Also from a ${placeTypes.map((t) => (t === 'new_device' ? 'device' : 'country')).join(' and ')} not seen before.`
      : '';
    signals.push({
      rule: 3,
      type: 'possible_compromise',
      severity: 'critical',
      message: `Successful login after ${f.failedForUserRecent} failed attempts in ${minutes(pc.windowSeconds)}.${extra}`,
      ...(related.length ? { related } : {}),
    });
  } else if (placeTypes.length) {
    // Rule 2 (+ section 6). Both = HIGH in one alert; new device after recent
    // failures = HIGH; otherwise MEDIUM. Rule 8 (new IP) is merged in.
    const severity: Severity =
      placeTypes.length === 2 || (newDevice && f.failedForUserRecent > 0) ? 'high' : 'medium';
    const [type, ...others] = placeTypes;
    const related = [...others, ...(newIp ? (['new_ip'] as const) : [])];
    const what = placeTypes.length === 2 ? 'new device and new country' : type.replace('_', ' ');
    const why = newDevice && f.failedForUserRecent > 0 && placeTypes.length === 1
      ? ` after ${f.failedForUserRecent} recent failed login(s)`
      : '';
    signals.push({
      rule: 2,
      type,
      severity,
      message: `Successful login from a ${what}${why}`,
      ...(related.length ? { related } : {}),
    });
  } else if (newIp) {
    // Rule 8 on its own.
    signals.push({
      rule: 8,
      type: 'new_ip',
      severity: 'low',
      message: 'Successful login from an IP this user has never logged in from',
    });
  }

  if (f.device === 'returning') {
    signals.push({
      rule: 0,
      type: 'returning_device',
      severity: 'low',
      message: `Known device returning after ${rules.returningDevice.inactiveDays}+ days`,
    });
  }

  // Rule 6: rapid repeated successful logins.
  const rl = rules.rapidLogins;
  if (f.successesForUserRecent >= rl.threshold) {
    signals.push({
      rule: 6,
      type: 'rapid_logins',
      severity: 'low',
      message: `${f.successesForUserRecent} successful logins in ${rl.windowSeconds}s`,
    });
  }

  // Rule 9: login at an hour this user never logs in.
  const ut = rules.unusualTime;
  if (f.loginsInLookback >= ut.minLogins && f.loginsThisHour === 0) {
    signals.push({
      rule: 9,
      type: 'unusual_time',
      severity: 'low',
      message: `No logins at this hour in the last ${ut.lookbackDays} days (${f.loginsInLookback} logins total)`,
    });
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Stage 02: Score
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: RiskLevel[] = ['none', 'low', 'medium', 'high', 'critical'];

export function scoreSignals(signals: LoginSignal[]): { score: number; level: RiskLevel } {
  const score = signals.reduce((sum, s) => sum + SEVERITY_WEIGHTS[s.severity], 0);
  const fromScore = SCORE_THRESHOLDS.find(([, min]) => score >= min)?.[0] ?? 'none';
  const highestSignal = signals.reduce<RiskLevel>(
    (max, s) => (rank(s.severity) > rank(max) ? s.severity : max),
    'none',
  );
  // Combining can raise the level (e.g. two LOWs -> MEDIUM) but never lower it.
  const level = rank(fromScore) > rank(highestSignal) ? fromScore : highestSignal;
  return { score, level };
}

// ---------------------------------------------------------------------------
// Stage 03: Protect
// ---------------------------------------------------------------------------

/**
 * Lockouts follow the facts, not the signals: a repeat alert may be dropped
 * (see LoginDetectorService) but the target must still be locked.
 */
export function decideResponse(
  f: LoginFacts,
  level: RiskLevel,
  rules: LoginRulesConfig = LOGIN_RULES,
): LoginDecision {
  const locks: LockAction[] = [];

  const bf = rules.bruteForce;
  if (!f.success && f.failedForEmail >= bf.threshold) {
    locks.push({ target: 'email', reason: 'brute_force', baseMinutes: bf.lockMinutes });
  }
  if (!f.success && f.failedForIp >= bf.threshold) {
    locks.push({ target: 'ip', reason: 'brute_force', baseMinutes: bf.lockMinutes });
  }
  if (
    f.distinctEmailsFromIp >= rules.credentialStuffing.threshold &&
    !locks.some((l) => l.target === 'ip')
  ) {
    locks.push({
      target: 'ip',
      reason: 'credential_stuffing',
      baseMinutes: rules.credentialStuffing.lockMinutes,
    });
  }

  const denyToken = f.success && level === 'critical';

  let action: LoginAction = 'allow';
  if (denyToken) action = 'deny';
  else if (locks.length) action = 'block';
  else if (level !== 'none') action = 'allow_and_alert';

  return { action, locks, denyToken };
}

/** Lockout length for a target that was already locked `previousLocks` times recently. */
export function lockoutMinutes(
  baseMinutes: number,
  previousLocks: number,
  rules: LoginRulesConfig = LOGIN_RULES,
): number {
  return Math.min(baseMinutes * 2 ** previousLocks, rules.lockoutEscalation.maxMinutes);
}

/** Hour of day (0-23) for `date` in an IANA timezone such as "Asia/Phnom_Penh". */
export function hourInTimeZone(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone,
  }).format(date);
  return Number(hour);
}

function rank(level: RiskLevel): number {
  return SEVERITY_ORDER.indexOf(level);
}

function minutes(seconds: number): string {
  return `${seconds / 60} min`;
}
