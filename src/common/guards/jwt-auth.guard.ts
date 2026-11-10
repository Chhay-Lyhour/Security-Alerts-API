import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { routeNotFound } from '../http/route-not-found.js';

const BEARER_PREFIX = /^Bearer\s+\S+/i;

/**
 * Global guard: every route needs a valid JWT unless it is marked `@Public()`.
 *
 * - No bearer token at all: the same 404 as an unknown route, so anonymous
 *   probing cannot tell which protected routes exist.
 * - A bearer token that is invalid or expired: 401, so real clients know to
 *   use their refresh token.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (!BEARER_PREFIX.test(request.header('authorization') ?? '')) {
      this.logger.warn(
        `No bearer token: ${request.method} ${request.originalUrl} ip=${request.ip}`,
      );
      throw routeNotFound(request);
    }
    return super.canActivate(context);
  }
}
