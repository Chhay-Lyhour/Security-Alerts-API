import type { Alert } from '../../alerts/entities/alert.entity.js';
import { formatAlertMessage } from './alert-message.js';

const base = {
  id: 'a1',
  title: 'Rule "5 failed logins": 5 failed_login alerts in 60s',
  type: 'failed_login',
  severity: 'high',
  ipAddress: '203.0.113.7',
  createdAt: new Date('2026-11-18T00:00:00Z'),
  source: { name: 'nek-rean-it' },
};

const escalationFields = {
  ...base,
  payload: {
    ruleId: 'r1',
    ruleName: '5 failed logins',
    matchedCount: 5,
    threshold: 5,
    windowSeconds: 60,
  },
};
const escalation = escalationFields as unknown as Alert;

describe('formatAlertMessage', () => {
  it('names the source, the rule and the firewall response for a high escalation', () => {
    const { subject, body } = formatAlertMessage(escalation, {
      autoBlockMinutes: 60,
      baseUrl: 'https://api.example.com/',
    });
    expect(subject).toBe(
      '[HIGH] Rule "5 failed logins": 5 failed_login alerts in 60s',
    );
    expect(body).toContain('Source: nek-rean-it');
    expect(body).toContain('Rule: 5 failed logins (5 of 5 in 60s)');
    expect(body).toContain('Response: IP blocked by the firewall for 60 min');
    expect(body).toContain('Dashboard: https://api.example.com/dashboard/');
  });

  it.each([
    ['auto-blocking is off', { autoBlockMinutes: 0 }, escalation],
    [
      'the rule is only medium',
      { autoBlockMinutes: 60 },
      { ...escalationFields, severity: 'medium' },
    ],
  ])('says "flagged" when %s', (_why, options, alert) => {
    expect(formatAlertMessage(alert as Alert, options).body).toContain(
      'Response: flagged for analysts',
    );
  });

  it('describes a login-engine alert by account, score and response', () => {
    const body = formatAlertMessage({
      ...base,
      type: 'brute_force',
      payload: {
        engine: 'login',
        email: 'admin@lotus.demo',
        score: 50,
        action: 'block',
      },
    } as unknown as Alert).body;
    expect(body).toContain('Account: admin@lotus.demo');
    expect(body).toContain('Risk score: 50');
    expect(body).toContain('Response: email or IP locked out (429)');
    expect(body).not.toContain('Dashboard:');
  });

  it('leaves out what it does not know', () => {
    const body = formatAlertMessage({
      ...base,
      ipAddress: null,
      source: undefined,
      payload: {},
    } as unknown as Alert).body;
    expect(body).not.toMatch(/IP:|Source:|Response:/);
  });
});
