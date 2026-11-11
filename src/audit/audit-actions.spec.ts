import type { AuthUser } from '../common/types/auth-user.type.js';
import { UserRole } from '../users/entities/user-role.enum.js';
import {
  describeRequest,
  outcomeFor,
  PRIVILEGED_ROUTES,
  type FinishedRequest,
} from './audit-actions.js';
import { AuditOutcome } from './entities/audit-outcome.enum.js';

const analyst: AuthUser = {
  id: 'u-1',
  email: 'analyst@example.com',
  role: UserRole.ANALYST,
};
const alertId = '3f2a6c1e-0000-4000-8000-000000000001';

const request = (overrides: Partial<FinishedRequest>): FinishedRequest => ({
  method: 'PATCH',
  route: '/alerts/:id/status',
  url: `/alerts/${alertId}/status`,
  statusCode: 200,
  user: analyst,
  params: { id: alertId },
  body: { status: 'acknowledged' },
  responseBody: undefined,
  ip: '203.0.113.5',
  ...overrides,
});

describe('outcomeFor', () => {
  it.each([
    [200, AuditOutcome.SUCCESS],
    [204, AuditOutcome.SUCCESS],
    [401, AuditOutcome.DENIED],
    [403, AuditOutcome.DENIED],
    [404, AuditOutcome.FAILED],
    [409, AuditOutcome.FAILED],
    [500, AuditOutcome.FAILED],
  ])('maps %i to %s', (status, outcome) => {
    expect(outcomeFor(status)).toBe(outcome);
  });
});

describe('describeRequest', () => {
  it('records who acknowledged which alert, from where', () => {
    expect(describeRequest(request({}))).toEqual({
      userId: 'u-1',
      actorEmail: 'analyst@example.com',
      actorRole: 'analyst',
      action: 'acknowledged_alert',
      outcome: AuditOutcome.SUCCESS,
      targetType: 'alert',
      targetId: alertId,
      method: 'PATCH',
      path: `/alerts/${alertId}/status`,
      statusCode: 200,
      ip: '203.0.113.5',
      metadata: { status: 'acknowledged' },
    });
  });

  it.each([
    ['resolved', 'resolved_alert'],
    ['open', 'changed_alert_status'],
  ])('names a status change to %s as %s', (status, action) => {
    expect(describeRequest(request({ body: { status } }))?.action).toBe(action);
  });

  it('takes the target id of a created record from the response', () => {
    const entry = describeRequest(
      request({
        method: 'POST',
        route: '/sources',
        url: '/sources',
        statusCode: 201,
        params: {},
        body: { name: 'web-1' },
        responseBody: { id: 'src-1', name: 'web-1', apiKey: 'sa_secret' },
      }),
    );
    expect(entry).toMatchObject({
      action: 'created_source',
      targetType: 'source',
      targetId: 'src-1',
    });
  });

  it('never copies secrets or unlisted fields into metadata', () => {
    const entry = describeRequest(
      request({
        method: 'POST',
        route: '/sources',
        url: '/sources',
        statusCode: 201,
        params: {},
        body: { name: 'web-1', apiKey: 'sa_secret', password: 'hunter2' },
        responseBody: { id: 'src-1', apiKey: 'sa_secret' },
      }),
    );
    expect(entry?.metadata).toEqual({ name: 'web-1' });
    expect(JSON.stringify(entry)).not.toContain('sa_secret');
    expect(JSON.stringify(entry)).not.toContain('hunter2');
  });

  it('keeps only short scalar values', () => {
    const entry = describeRequest(
      request({
        method: 'PATCH',
        route: '/rules/:id',
        url: '/rules/r-1',
        params: { id: 'r-1' },
        body: {
          name: 'x'.repeat(500),
          threshold: 5,
          isEnabled: false,
          type: { nested: true },
        },
      }),
    );
    expect(entry?.metadata).toEqual({
      name: 'x'.repeat(200),
      threshold: 5,
      isEnabled: false,
    });
  });

  it('records denied and failed attempts at privileged routes too', () => {
    expect(
      describeRequest(
        request({ method: 'DELETE', route: '/alerts/:id', statusCode: 403 }),
      ),
    ).toMatchObject({
      action: 'deleted_alert',
      outcome: AuditOutcome.DENIED,
    });
    expect(describeRequest(request({ statusCode: 409 }))).toMatchObject({
      action: 'acknowledged_alert',
      outcome: AuditOutcome.FAILED,
    });
  });

  it('records a 403 on any other route as access_denied', () => {
    expect(
      describeRequest(
        request({
          method: 'GET',
          route: '/audit',
          url: '/audit',
          statusCode: 403,
          params: {},
          body: {},
        }),
      ),
    ).toMatchObject({
      action: 'access_denied',
      outcome: AuditOutcome.DENIED,
      targetType: null,
      path: '/audit',
    });
  });

  it('ignores ordinary reads and anonymous requests', () => {
    expect(
      describeRequest(
        request({ method: 'GET', route: '/alerts', url: '/alerts' }),
      ),
    ).toBeNull();
    expect(describeRequest(request({ user: undefined }))).toBeNull();
    expect(
      describeRequest(request({ user: undefined, statusCode: 403 })),
    ).toBeNull();
  });

  it('ignores unknown routes', () => {
    expect(
      describeRequest(request({ route: undefined, statusCode: 404 })),
    ).toBeNull();
  });

  it('covers every admin and analyst write route in SPECS.md', () => {
    expect(Object.keys(PRIVILEGED_ROUTES)).toEqual(
      expect.arrayContaining([
        'POST /sources',
        'POST /rules',
        'PATCH /rules/:id',
        'PATCH /alerts/:id/status',
        'DELETE /alerts/:id',
        'PATCH /devices/:id/trust',
        'DELETE /devices/:id',
      ]),
    );
  });
});
