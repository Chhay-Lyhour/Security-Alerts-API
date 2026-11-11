import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Audit trail (SPECS.md sections 2 and 4, step 5-6).
 *
 * The trigger makes the table append-only: any UPDATE or DELETE fails, even
 * from someone with direct database access through the app's account. Only
 * TRUNCATE (used by the e2e tests) and dropping the table get past it.
 */
export class CreateAuditLogs1794340000000 implements MigrationInterface {
  name = 'CreateAuditLogs1794340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."audit_outcome" AS ENUM('success', 'denied', 'failed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid,
        "actorEmail" varchar(255),
        "actorRole" varchar(20) NOT NULL,
        "action" varchar(64) NOT NULL,
        "outcome" "public"."audit_outcome" NOT NULL,
        "targetType" varchar(32),
        "targetId" varchar(64),
        "method" varchar(10),
        "path" varchar(255),
        "statusCode" integer,
        "ip" varchar(45),
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_createdAt" ON "audit_logs" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_userId_createdAt" ON "audit_logs" ("userId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_action" ON "audit_logs" ("action")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_targetId" ON "audit_logs" ("targetId")`,
    );

    await queryRunner.query(`
      CREATE FUNCTION "audit_logs_append_only"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_audit_logs_append_only"
      BEFORE UPDATE OR DELETE ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "TRG_audit_logs_append_only" ON "audit_logs"`,
    );
    await queryRunner.query(`DROP FUNCTION "audit_logs_append_only"()`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TYPE "public"."audit_outcome"`);
  }
}
