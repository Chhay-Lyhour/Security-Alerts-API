import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../users/entities/user-role.enum.js';

export const ROLES_KEY = 'roles';

/** Restricts a route or controller to the given roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
