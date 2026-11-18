import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity.js';
import { UserRole } from './entities/user-role.enum.js';
import { hashPassword } from './password.util.js';

type CreateUserInput = {
  email: string;
  password: string;
  role?: UserRole;
  timezone?: string | null;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email: normalizeEmail(email) } });
  }

  /** The only lookup that loads `passwordHash`; use it for credential checks only. */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: normalizeEmail(email) })
      .getOne();
  }

  async create(input: CreateUserInput): Promise<User> {
    const user = this.users.create({
      email: normalizeEmail(input.email),
      passwordHash: await hashPassword(input.password),
      role: input.role ?? UserRole.ANALYST,
      timezone: input.timezone ?? null,
    });
    const saved = await this.users.save(user);
    const { passwordHash: _omit, ...safe } = saved;
    return safe as User;
  }

  /** Like create(), but answers 409 when the email is already taken. */
  async createUnique(input: CreateUserInput): Promise<User> {
    if (await this.findByEmail(input.email)) {
      throw new ConflictException('Email already registered');
    }
    return this.create(input);
  }

  /** Every staff account, newest first. Never includes password hashes. */
  findAll(): Promise<User[]> {
    return this.users.find({ order: { createdAt: 'DESC' } });
  }

  async setRole(userId: string, role: UserRole): Promise<void> {
    await this.users.update({ id: userId }, { role });
  }
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();
