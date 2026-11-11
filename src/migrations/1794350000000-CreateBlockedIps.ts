import type { MigrationInterface, QueryRunner } from 'typeorm';

/** IP filter / firewall blocklist. */
export class CreateBlockedIps1794350000000 implements MigrationInterface {
  name = 'CreateBlockedIps1794350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."block_origin" AS ENUM('manual', 'auto')`,
    );
    await queryRunner.query(`
      CREATE TABLE "blocked_ips" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "network" varchar(49) NOT NULL,
        "reason" varchar(200) NOT NULL,
        "origin" "public"."block_origin" NOT NULL,
        "createdBy" uuid,
        "alertId" uuid,
        "expiresAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_blocked_ips_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_blocked_ips_network" ON "blocked_ips" ("network")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_blocked_ips_expiresAt" ON "blocked_ips" ("expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "blocked_ips"`);
    await queryRunner.query(`DROP TYPE "public"."block_origin"`);
  }
}
