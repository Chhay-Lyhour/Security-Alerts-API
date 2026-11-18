import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserRoleDto } from './dto/update-user-role.dto.js';
import { UserRole } from './entities/user-role.enum.js';
import { UsersService } from './users.service.js';

/**
 * Staff accounts. There is no public sign-up: an admin creates every account
 * and decides its role. Both writes are audited.
 */
@Controller('users')
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.createUnique(dto);
  }

  @Get()
  findAll() {
    return this.users.findAll();
  }

  /** Takes effect on the user's next request: every request re-reads the role. */
  @Patch(':id/role')
  async setRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() me: AuthUser,
  ) {
    // Stops the last admin from demoting themselves and locking everyone out.
    if (id === me.id) {
      throw new BadRequestException('You cannot change your own role');
    }
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException('User not found');
    await this.users.setRole(id, dto.role);
    user.role = dto.role;
    return user;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() me: AuthUser,
  ): Promise<void> {
    if (id === me.id) {
      throw new BadRequestException('You cannot delete your own account');
    }
    if (!(await this.users.remove(id))) {
      throw new NotFoundException('User not found');
    }
  }
}
