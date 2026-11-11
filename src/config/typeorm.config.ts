import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

const migrationsGlob = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  '*.{js,ts}',
);

/** Database connection settings, shared by the API and the CLI scripts. */
export const typeOrmOptions = (config: ConfigService): TypeOrmModuleOptions => {
  // Docker sets this so a fresh container brings its own schema up to date
  // before serving. Locally, keep using `npm run migration:run`.
  const runMigrations =
    config.get<string>('DATABASE_RUN_MIGRATIONS') === 'true';
  return {
    type: 'postgres',
    host: config.get<string>('DATABASE_HOST'),
    port: Number(config.get('DATABASE_PORT', 5432)),
    username: config.get<string>('DATABASE_USER'),
    password: config.get<string>('DATABASE_PASSWORD'),
    database: config.get<string>('DATABASE_NAME'),
    autoLoadEntities: true,
    synchronize: false,
    ...(runMigrations && { migrations: [migrationsGlob], migrationsRun: true }),
  };
};
