import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../types/auth-user.type.js';

/** Injects the authenticated user, or one field of it: `@CurrentUser('id')`. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest<Request>().user as
      | AuthUser
      | undefined;
    return field ? user?.[field] : user;
  },
);
