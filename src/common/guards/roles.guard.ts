import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { UserRole } from '../../users/entities/user-role.enum.js';
import type { AuthUser } from '../types/auth-user.type.js';

/**
 * Global guard that enforces `@Roles(...)`. Routes without the decorator are
 * open to any authenticated user. Runs after JwtAuthGuard.
 *
 * A logged-in caller without the required role gets 403 Forbidden. The
 * details are logged server-side.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthUser | undefined;
    if (user && required.includes(user.role)) return true;

    this.logger.warn(
      `Role check failed: ${request.method} ${request.originalUrl} user=${user?.id ?? 'none'} role=${user?.role ?? 'none'} required=${required.join('|')} ip=${request.ip}`,
    );
    throw new ForbiddenException('You do not have permission for this action');
  }
}
