import type { Alert } from '../../alerts/entities/alert.entity.js';

/** Context the message needs beyond the alert itself. */
export interface AlertMessageOptions {
  /** FIREWALL_AUTO_BLOCK_MINUTES; 0 means rules never block. */
  autoBlockMinutes?: number;
  /** Public base URL of this API, for a link to the dashboard. */
  baseUrl?: string;
}

const LOGIN_ACTIONS: Record<string, string> = {
  block: 'email or IP locked out (429)',
  deny: 'correct password, but no token issued (401)',
  allow_and_alert: 'login allowed, flagged for review',
  allow: 'login allowed',
};

/**
 * Plain-text summary of an alert, shared by every channel. Says what was
 * detected, how it was scored and what the system did about it, so whoever
 * reads it on a phone knows whether to act.
 */
export function formatAlertMessage(
  alert: Alert,
  options: AlertMessageOptions = {},
): { subject: string; body: string } {
  const subject = `[${alert.severity.toUpperCase()}] ${alert.title}`;
  const p = alert.payload ?? {};
  const lines: (string | null)[] = [
    subject,
    alert.source?.name ? `Source: ${alert.source.name}` : null,
    `Type: ${alert.type}`,
    alert.ipAddress ? `IP: ${alert.ipAddress}` : null,
  ];

  if (typeof p.ruleId === 'string') {
    // Escalation from an alert rule (connected apps).
    lines.push(
      `Rule: ${String(p.ruleName)} (${String(p.matchedCount)} of ${String(p.threshold)} in ${String(p.windowSeconds)}s)`,
    );
    const blocks =
      (alert.severity === 'high' || alert.severity === 'critical') &&
      !!alert.ipAddress &&
      (options.autoBlockMinutes ?? 0) > 0;
    lines.push(
      blocks
        ? `Response: IP blocked by the firewall for ${options.autoBlockMinutes} min`
        : 'Response: flagged for analysts',
    );
  } else if (p.engine === 'login') {
    // From the login detection engine.
    if (typeof p.email === 'string') lines.push(`Account: ${p.email}`);
    if (typeof p.score === 'number') lines.push(`Risk score: ${p.score}`);
    if (typeof p.action === 'string') {
      lines.push(`Response: ${LOGIN_ACTIONS[p.action] ?? p.action}`);
    }
  }

  lines.push(
    `Alert ID: ${alert.id}`,
    `Created: ${new Date(alert.createdAt).toISOString()}`,
    options.baseUrl
      ? `Dashboard: ${options.baseUrl.replace(/\/+$/, '')}/dashboard/`
      : null,
  );
  return {
    subject,
    body: lines.filter((l): l is string => l !== null).join('\n'),
  };
}
