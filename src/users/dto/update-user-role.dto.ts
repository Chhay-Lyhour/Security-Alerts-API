import { IsEnum } from 'class-validator';
import { UserRole } from '../entities/user-role.enum.js';

/** Body of PATCH /users/:id/role. */
export class UpdateUserRoleDto {
  @IsEnum(UserRole)
  role: UserRole;
}
