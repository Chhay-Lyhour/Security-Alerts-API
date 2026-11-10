import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersAndSources1762700000000 implements MigrationInterface {
  name = 'CreateUsersAndSources1762700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "users_role_enum" AS ENUM ('admin', 'analyst')`,
    );
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" varchar(255) NOT NULL,
        "passwordHash" varchar(255) NOT NULL,
        "role" "users_role_enum" NOT NULL DEFAULT 'analyst',
        "timezone" varchar(64),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "sources" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(120) NOT NULL,
        "apiKeyHash" char(64) NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sources_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sources_name" UNIQUE ("name"),
        CONSTRAINT "UQ_sources_apiKeyHash" UNIQUE ("apiKeyHash")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sources"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "users_role_enum"`);
  }
}
