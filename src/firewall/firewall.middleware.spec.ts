import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { FirewallService, IpVerdict } from './firewall.service.js';
import { BLOCKED_MESSAGE, FirewallMiddleware } from './firewall.middleware.js';

describe('FirewallMiddleware', () => {
  const verdict = (blocked: boolean): IpVerdict => ({
    ip: '203.0.113.9',
    blocked,
    allowlisted: false,
    reason: blocked ? 'scanner' : null,
    expiresAt: null,
    blockedIpId: blocked ? 'b-1' : null,
  });
  const firewall = { check: vi.fn() };
  const middleware = new FirewallMiddleware(
    firewall as unknown as FirewallService,
  );
  const req = {
    ip: '::ffff:203.0.113.9',
    method: 'POST',
    originalUrl: '/auth/login',
    headers: {},
    app: { get: () => undefined },
  } as unknown as Request;
  const res = {} as Response;

  beforeEach(() => vi.clearAllMocks());

  it('lets an unblocked IP through', () => {
    firewall.check.mockReturnValue(verdict(false));
    const next = vi.fn();
    middleware.use(req, res, next);
    expect(firewall.check).toHaveBeenCalledWith('203.0.113.9');
    expect(next).toHaveBeenCalledOnce();
  });

  it('turns a blocked IP away with a 403 that gives nothing away', () => {
    firewall.check.mockReturnValue(verdict(true));
    const next = vi.fn();
    const run = () => middleware.use(req, res, next);

    expect(run).toThrow(ForbiddenException);
    expect(run).toThrow(BLOCKED_MESSAGE);
    expect(next).not.toHaveBeenCalled();
  });
});
