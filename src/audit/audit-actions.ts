import type { AuthUser } from '../common/types/auth-user.type.js';
import { AuditOutcome } from './entities/audit-outcome.enum.js';

/** What the audit trail records for one finished request. */
export interface AuditEntry {
  userId: string | null;
  actorEmail: string | null;
  actorRole: string;
  action: string;
  outcome: AuditOutcome;
  targetType: string | null;
  targetId: string | null;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  ip: string | null;
  metadata: Record<string, unknown>;
}

/** A finished HTTP request, reduced to what auditing needs. */
export interface FinishedRequest {
  method: string;
  /** The matched route pattern, e.g. `/alerts/:id/status`. Undefined for unknown routes. */
  route: string | undefined;
  /** The real URL, e.g. `/alerts/3f2a.../status`. */
  url: string;
  statusCode: number;
  user: AuthUser | undefined;
  params: Record<string, string | string[] | undefined>;
  body: unknown;
  responseBody: unknown;
  ip: string;
}

interface PrivilegedRoute {
  action: string | ((body: Record<string, unknown>) => string);
  targetType: string;
  /** Where the target's id comes from: the `:id` route param, or the `id` of the created record. */
  targetFrom: 'param' | 'response';
  /** Request body fields worth keeping. Anything not listed is dropped. */
  keep?: string[];
}

/**
 * Every privileged (state-changing) route, keyed by `METHOD /route/pattern`.
 * Add a line here when a new admin or analyst action is added.
 */
export const PRIVILEGED_ROUTES: Record<string, PrivilegedRoute> = {
  'POST /sources': {
    action: 'created_source',
    targetType: 'source',
    targetFrom: 'response',
    keep: ['name'],
  },
  'POST /rules': {
    action: 'created_rule',
    targetType: 'rule',
    targetFrom: 'response',
    keep: [
      'name',
      'type',
      'threshold',
      'windowSeconds',
      'severity',
      'isEnabled',
    ],
  },
  'PATCH /rules/:id': {
    action: 'updated_rule',
    targetType: 'rule',
    targetFrom: 'param',
    keep: [
      'name',
      'type',
      'threshold',
      'windowSeconds',
      'severity',
      'isEnabled',
    ],
  },
  'PATCH /alerts/:id/status': {
    action: (body) => {
      if (body.status === 'acknowledged') return 'acknowledged_alert';
      if (body.status === 'resolved') return 'resolved_alert';
      return 'changed_alert_status';
    },
    targetType: 'alert',
    targetFrom: 'param',
    keep: ['status'],
  },
  'DELETE /alerts/:id': {
    action: 'deleted_alert',
    targetType: 'alert',
    targetFrom: 'param',
  },
  'PATCH /devices/:id/trust': {
    action: 'trusted_device',
    targetType: 'device',
    targetFrom: 'param',
  },
  'DELETE /devices/:id': {
    action: 'revoked_device',
    targetType: 'device',
    targetFrom: 'param',
  },
  'POST /firewall/blocked-ips': {
    action: 'blocked_ip',
    targetType: 'blocked_ip',
    targetFrom: 'response',
    keep: ['ip', 'reason', 'expiresInMinutes'],
  },
  'DELETE /firewall/blocked-ips/:id': {
    action: 'unblocked_ip',
    targetType: 'blocked_ip',
    targetFrom: 'param',
  },
};

export const ACCESS_DENIED = 'access_denied';

export function outcomeFor(statusCode: number): AuditOutcome {
  if (statusCode < 400) return AuditOutcome.SUCCESS;
  if (statusCode === 401 || statusCode === 403) return AuditOutcome.DENIED;
  return AuditOutcome.FAILED;
}

/**
 * Decides whether a finished request goes into the audit trail.
 *
 * - Privileged routes are recorded for every logged-in caller, whatever
 *   the result, so failed and denied attempts show up too.
 * - Any other route is recorded only when a logged-in caller was refused
 *   (403), e.g. an analyst opening `GET /audit`.
 * - Anonymous requests are never recorded: without a token the API answers
 *   404, and logging those would let anyone flood the table.
 */
export function describeRequest(req: FinishedRequest): AuditEntry | null {
  if (!req.user) return null;

  const base = {
    userId: req.user.id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    outcome: outcomeFor(req.statusCode),
    method: req.method,
    path: req.url.slice(0, 255),
    statusCode: req.statusCode,
    ip: req.ip,
  };

  const route = req.route
    ? PRIVILEGED_ROUTES[`${req.method} ${req.route}`]
    : undefined;
  if (!route) {
    if (req.statusCode !== 403) return null;
    return {
      ...base,
      action: ACCESS_DENIED,
      targetType: null,
      targetId: null,
      metadata: {},
    };
  }

  const body = isRecord(req.body) ? req.body : {};
  const action =
    typeof route.action === 'function' ? route.action(body) : route.action;
  const targetId =
    route.targetFrom === 'param'
      ? typeof req.params.id === 'string'
        ? req.params.id.slice(0, 64)
        : null
      : isRecord(req.responseBody) && typeof req.responseBody.id === 'string'
        ? req.responseBody.id
        : null;

  return {
    ...base,
    action,
    targetType: route.targetType,
    targetId,
    metadata: pick(body, route.keep ?? []),
  };
}

function pick(
  body: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    const value = body[key];
    if (value === undefined) continue;
    // Only short scalars: the trail is evidence, not a copy of the payload.
    if (typeof value === 'string') picked[key] = value.slice(0, 200);
    else if (typeof value === 'number' || typeof value === 'boolean')
      picked[key] = value;
  }
  return picked;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
