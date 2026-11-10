/**
 * Creates an admin account, or promotes an existing user to admin.
 *
 *   npm run seed:admin
 *   npm run seed:admin -- --email admin@example.com
 *
 * The password is typed at a hidden prompt, so it never lands in a file or in
 * shell history. Input can also be piped (email line, then password twice).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from '../auth/dto/register.dto.js';
import { UserRole } from '../users/entities/user-role.enum.js';
import { UsersService } from '../users/users.service.js';
import { ask, askHidden } from './prompt.js';
import { SeedModule } from './seed.module.js';

const emailFromArgs = (): string | undefined => {
  const index = process.argv.indexOf('--email');
  return index >= 0 ? process.argv[index + 1] : undefined;
};

/** Same rules as POST /auth/register, checked one field at a time. */
const assertValid = async (field: 'email' | 'password', value: string) => {
  const dto = plainToInstance(RegisterDto, { [field]: value });
  const errors = await validate(dto);
  const messages = errors
    .filter((error) => error.property === field)
    .flatMap((error) => Object.values(error.constraints ?? {}));
  if (messages.length > 0) throw new Error(messages.join('\n'));
};

const withUsersService = async <T>(work: (users: UsersService) => Promise<T>) => {
  const app = await NestFactory.createApplicationContext(SeedModule, {
    logger: ['error'],
  });
  try {
    return await work(app.get(UsersService));
  } finally {
    await app.close();
  }
};

const promoteExisting = async (users: UsersService, email: string) => {
  const existing = await users.findByEmail(email);
  if (!existing) return false;

  if (existing.role === UserRole.ADMIN) {
    console.log(`✔ ${existing.email} is already an admin. Nothing changed.`);
    return true;
  }
  const answer = await ask(
    `${existing.email} exists as ${existing.role}. Promote to admin? Their password is not changed. (y/N) `,
  );
  if (answer.toLowerCase() !== 'y') {
    console.log('Nothing changed.');
    return true;
  }
  await users.setRole(existing.id, UserRole.ADMIN);
  console.log(`✔ ${existing.email} is now an admin.`);
  return true;
};

const main = async () => {
  const email = emailFromArgs() ?? (await ask('Admin email: '));
  await assertValid('email', email);

  await withUsersService(async (users) => {
    if (await promoteExisting(users, email)) return;

    const password = await askHidden('Password (12-128 characters): ');
    await assertValid('password', password);
    const confirmation = await askHidden('Confirm password: ');
    if (password !== confirmation) throw new Error('Passwords do not match');

    const admin = await users.create({ email, password, role: UserRole.ADMIN });
    console.log(`✔ Admin ${admin.email} created.`);
  });
};

try {
  await main();
} catch (error) {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  // A piped stdin keeps a readline interface open; don't wait on it.
  process.exit();
}
