import {
  decideResponse,
  evaluateLoginRules,
  hourInTimeZone,
  lockoutMinutes,
  scoreSignals,
  type LoginFacts,
  type LoginSignal,
} from './login-rules.js';

/** A quiet failed attempt: no rule fires. */
function failed(overrides: Partial<LoginFacts> = {}): LoginFacts {
  return {
    success: false,
    emailExists: true,
    failedForEmail: 1,
    failedForIp: 1,
    distinctEmailsFromIp: 1,
    unknownEmailFailuresFromIp: 0,
    lockoutJustExpired: false,
    failedForUserRecent: 0,
    successesForUserRecent: 0,
    hasLoginHistory: false,
    device: null,
    countrySeenBefore: null,
    ipSeenBefore: true,
    loginsInLookback: 0,
    loginsThisHour: 0,
    ...overrides,
  };
}

/** A normal successful login from a known device, IP and country. */
function success(overrides: Partial<LoginFacts> = {}): LoginFacts {
  return failed({
    success: true,
    failedForEmail: 0,
    failedForIp: 0,
    successesForUserRecent: 1,
    hasLoginHistory: true,
    device: 'same',
    countrySeenBefore: true,
    ipSeenBefore: true,
    loginsInLookback: 20,
    loginsThisHour: 3,
    ...overrides,
  });
}

const types = (signals: LoginSignal[]) => signals.map((s) => s.type);

describe('evaluateLoginRules', () => {
  it('fires nothing for normal attempts', () => {
    expect(evaluateLoginRules(failed())).toEqual([]);
    expect(evaluateLoginRules(success())).toEqual([]);
  });

  describe('rule 1: brute force', () => {
    it('fires HIGH at 20 failures for one email', () => {
      const [signal] = evaluateLoginRules(failed({ failedForEmail: 20 }));
      expect(signal).toMatchObject({ rule: 1, type: 'brute_force', severity: 'high' });
    });

    it('fires at 20 failures from one IP', () => {
      expect(types(evaluateLoginRules(failed({ failedForIp: 20 })))).toEqual(['brute_force']);
    });

    it('does not fire at 19', () => {
      expect(evaluateLoginRules(failed({ failedForEmail: 19, failedForIp: 19 }))).toEqual([]);
    });
  });

  describe('rule 2: new device / new country (+ rule 8 merged)', () => {
    it('new device alone is MEDIUM', () => {
      const [signal] = evaluateLoginRules(success({ device: 'new' }));
      expect(signal).toMatchObject({ rule: 2, type: 'new_device', severity: 'medium' });
    });

    it('new country alone is MEDIUM', () => {
      const [signal] = evaluateLoginRules(success({ countrySeenBefore: false }));
      expect(signal).toMatchObject({ rule: 2, type: 'new_country', severity: 'medium' });
    });

    it('both is one HIGH alert, with the new IP folded in', () => {
      const signals = evaluateLoginRules(
        success({ device: 'new', countrySeenBefore: false, ipSeenBefore: false }),
      );
      expect(signals).toHaveLength(1);
      expect(signals[0]).toMatchObject({
        type: 'new_device',
        severity: 'high',
        related: ['new_country', 'new_ip'],
      });
    });

    it('new device after recent failures is HIGH (section 6)', () => {
      const [signal] = evaluateLoginRules(success({ device: 'new', failedForUserRecent: 2 }));
      expect(signal).toMatchObject({ type: 'new_device', severity: 'high' });
    });

    it('unknown country never counts as new', () => {
      expect(evaluateLoginRules(success({ countrySeenBefore: null }))).toEqual([]);
    });

    it("skips the user's very first login (no baseline yet)", () => {
      const first = success({ hasLoginHistory: false, device: 'new', ipSeenBefore: false, countrySeenBefore: false });
      expect(evaluateLoginRules(first)).toEqual([]);
    });
  });

  describe('rule 3: success after many failures', () => {
    it('is CRITICAL at 5 failures', () => {
      const [signal] = evaluateLoginRules(success({ failedForUserRecent: 5 }));
      expect(signal).toMatchObject({ rule: 3, type: 'possible_compromise', severity: 'critical' });
    });

    it('stays one critical alert and notes the new device', () => {
      const signals = evaluateLoginRules(success({ failedForUserRecent: 6, device: 'new' }));
      expect(signals).toHaveLength(1);
      expect(signals[0]).toMatchObject({ severity: 'critical', related: ['new_device'] });
      expect(signals[0].message).toContain('device not seen before');
    });
  });

  it('rule 4: credential stuffing is HIGH at 10 distinct emails', () => {
    const [signal] = evaluateLoginRules(failed({ distinctEmailsFromIp: 10 }));
    expect(signal).toMatchObject({ rule: 4, type: 'credential_stuffing', severity: 'high' });
  });

  describe('rule 5: account enumeration', () => {
    it('is MEDIUM at 5 failures on unknown emails', () => {
      const [signal] = evaluateLoginRules(failed({ emailExists: false, unknownEmailFailuresFromIp: 5 }));
      expect(signal).toMatchObject({ rule: 5, type: 'account_enumeration', severity: 'medium' });
    });

    it('only counts attempts on unknown emails', () => {
      expect(evaluateLoginRules(failed({ emailExists: true, unknownEmailFailuresFromIp: 9 }))).toEqual([]);
    });
  });

  it('rule 6: rapid logins is LOW at 5 successes', () => {
    expect(evaluateLoginRules(success({ successesForUserRecent: 5 }))[0]).toMatchObject({
      rule: 6,
      severity: 'low',
    });
  });

  it('rule 7: attempt right after a lockout is MEDIUM', () => {
    expect(evaluateLoginRules(failed({ lockoutJustExpired: true }))[0]).toMatchObject({
      rule: 7,
      type: 'post_lockout_attempt',
      severity: 'medium',
    });
  });

  it('rule 8: new IP alone is LOW', () => {
    expect(evaluateLoginRules(success({ ipSeenBefore: false }))[0]).toMatchObject({
      rule: 8,
      type: 'new_ip',
      severity: 'low',
    });
  });

  describe('rule 9: unusual time', () => {
    it('is LOW when this hour has 0 of 10+ logins', () => {
      expect(evaluateLoginRules(success({ loginsInLookback: 10, loginsThisHour: 0 }))[0]).toMatchObject({
        rule: 9,
        type: 'unusual_time',
        severity: 'low',
      });
    });

    it('needs at least 10 logins of history', () => {
      expect(evaluateLoginRules(success({ loginsInLookback: 9, loginsThisHour: 0 }))).toEqual([]);
    });
  });

  it('section 6: a device back after 30+ days is LOW', () => {
    expect(types(evaluateLoginRules(success({ device: 'returning' })))).toEqual(['returning_device']);
  });
});

describe('scoreSignals', () => {
  const signal = (severity: LoginSignal['severity']): LoginSignal => ({
    rule: 0,
    type: 'new_ip',
    severity,
    message: '',
  });

  it('is none with no signals', () => {
    expect(scoreSignals([])).toEqual({ score: 0, level: 'none' });
  });

  it('keeps a single signal at its own level', () => {
    expect(scoreSignals([signal('low')]).level).toBe('low');
    expect(scoreSignals([signal('critical')]).level).toBe('critical');
  });

  it('combines two LOWs into MEDIUM (new IP + unusual time)', () => {
    const signals = evaluateLoginRules(success({ ipSeenBefore: false, loginsThisHour: 0 }));
    expect(types(signals)).toEqual(['new_ip', 'unusual_time']);
    expect(scoreSignals(signals)).toEqual({ score: 20, level: 'medium' });
  });

  it('never lowers the highest signal', () => {
    expect(scoreSignals([signal('high'), signal('low')]).level).toBe('high');
  });
});

describe('decideResponse', () => {
  it('allows normal logins', () => {
    expect(decideResponse(success(), 'none')).toEqual({ action: 'allow', locks: [], denyToken: false });
  });

  it('allows but alerts on low/medium risk', () => {
    expect(decideResponse(success(), 'medium').action).toBe('allow_and_alert');
  });

  it('locks the email for brute force on one account', () => {
    const decision = decideResponse(failed({ failedForEmail: 20 }), 'high');
    expect(decision.action).toBe('block');
    expect(decision.locks).toEqual([{ target: 'email', reason: 'brute_force', baseMinutes: 15 }]);
  });

  it('locks the IP once for brute force + credential stuffing from it', () => {
    const decision = decideResponse(failed({ failedForIp: 25, distinctEmailsFromIp: 12 }), 'critical');
    expect(decision.locks).toEqual([{ target: 'ip', reason: 'brute_force', baseMinutes: 15 }]);
  });

  it('locks the IP for credential stuffing', () => {
    expect(decideResponse(failed({ distinctEmailsFromIp: 10 }), 'high').locks).toEqual([
      { target: 'ip', reason: 'credential_stuffing', baseMinutes: 15 },
    ]);
  });

  it('denies the token on a critical successful login', () => {
    expect(decideResponse(success({ failedForUserRecent: 5 }), 'critical')).toMatchObject({
      action: 'deny',
      denyToken: true,
    });
  });
});

describe('lockoutMinutes', () => {
  it('doubles for each recent lockout and caps at 24h', () => {
    expect(lockoutMinutes(15, 0)).toBe(15);
    expect(lockoutMinutes(15, 1)).toBe(30);
    expect(lockoutMinutes(15, 2)).toBe(60);
    expect(lockoutMinutes(15, 20)).toBe(24 * 60);
  });
});

describe('hourInTimeZone', () => {
  it('converts to the given timezone', () => {
    const date = new Date('2026-01-15T23:30:00Z');
    expect(hourInTimeZone(date, 'UTC')).toBe(23);
    expect(hourInTimeZone(date, 'Asia/Phnom_Penh')).toBe(6); // UTC+7
  });
});
