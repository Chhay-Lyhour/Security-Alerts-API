import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/entities/user-role.enum.js';
import type { SourcesService } from '../../sources/sources.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { ApiKeyGuard } from './api-key.guard.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';

const contextFor = (request: Record<string, unknown>) =>
  ({
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const reflectorReturning = (key: string, value: unknown) => {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((k) =>
    k === key ? value : undefined,
  );
  return reflector;
};

describe('RolesGuard', () => {
  it('allows any authenticated user when no roles are required', () => {
    const guard = new RolesGuard(reflectorReturning(ROLES_KEY, undefined));
    expect(guard.canActivate(contextFor({ user: { role: UserRole.ANALYST } }))).toBe(true);
  });

  it('allows a user whose role is listed', () => {
    const guard = new RolesGuard(
      reflectorReturning(ROLES_KEY, [UserRole.ADMIN, UserRole.ANALYST]),
    );
    expect(guard.canActivate(contextFor({ user: { role: UserRole.ANALYST } }))).toBe(true);
  });

  it('answers 403 to a user without the role', () => {
    const guard = new RolesGuard(reflectorReturning(ROLES_KEY, [UserRole.ADMIN]));
    const request = {
      method: 'DELETE',
      originalUrl: '/alerts/123?x=1',
      user: { id: 'u1', role: UserRole.ANALYST },
    };
    expect(() => guard.canActivate(contextFor(request))).toThrow(ForbiddenException);
  });

  it('answers 403 when there is no user', () => {
    const guard = new RolesGuard(reflectorReturning(ROLES_KEY, [UserRole.ADMIN]));
    expect(() =>
      guard.canActivate(contextFor({ method: 'GET', originalUrl: '/audit' })),
    ).toThrow(ForbiddenException);
  });
});

describe('JwtAuthGuard', () => {
  const requestWithAuth = (authorization?: string) => ({
    method: 'GET',
    originalUrl: '/auth/me',
    header: (name: string) =>
      name.toLowerCase() === 'authorization' ? authorization : undefined,
  });

  it('lets @Public() routes through without a token', () => {
    const guard = new JwtAuthGuard(reflectorReturning(IS_PUBLIC_KEY, true));
    expect(guard.canActivate(contextFor(requestWithAuth()))).toBe(true);
  });

  it.each([undefined, '', 'Basic abc', 'Bearer'])(
    'returns the unknown-route 404 when there is no bearer token (%s)',
    (authorization) => {
      const guard = new JwtAuthGuard(reflectorReturning(IS_PUBLIC_KEY, false));
      expect(() => guard.canActivate(contextFor(requestWithAuth(authorization)))).toThrow(
        'Cannot GET /auth/me',
      );
    },
  );
});

describe('ApiKeyGuard', () => {
  const source = { id: 'src-1', name: 'firewall', isActive: true };
  const sourcesService = {
    findActiveByApiKey: vi.fn(async (key: string) =>
      key === 'good-key' ? source : null,
    ),
  } as unknown as SourcesService;
  const guard = new ApiKeyGuard(sourcesService);
  const requestWithKey = (key?: string) => ({
    header: (name: string) => (name === 'x-api-key' ? key : undefined),
  });

  it('attaches the source for a valid key', async () => {
    const request: Record<string, unknown> = requestWithKey('good-key');
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.source).toBe(source);
  });

  it('rejects a missing key with 401', async () => {
    await expect(guard.canActivate(contextFor(requestWithKey()))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an unknown or inactive key with 401', async () => {
    await expect(
      guard.canActivate(contextFor(requestWithKey('bad-key'))),
    ).rejects.toThrow(UnauthorizedException);
  });
});
