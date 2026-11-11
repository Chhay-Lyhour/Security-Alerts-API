import type { UserRole } from '../../users/entities/user-role.enum.js';

/** Shape the JWT strategy attaches to `request.user`. */
export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
};

export type JwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
};
