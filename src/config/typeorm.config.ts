import type { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

/** Database connection settings, shared by the API and the CLI scripts. */
export const typeOrmOptions = (config: ConfigService): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: config.get<string>('DATABASE_HOST'),
  port: Number(config.get('DATABASE_PORT', 5432)),
  username: config.get<string>('DATABASE_USER'),
  password: config.get<string>('DATABASE_PASSWORD'),
  database: config.get<string>('DATABASE_NAME'),
  autoLoadEntities: true,
  synchronize: false,
});
