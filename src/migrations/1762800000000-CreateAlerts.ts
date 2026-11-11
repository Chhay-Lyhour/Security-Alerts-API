import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAlerts1762800000000 implements MigrationInterface {
  name = 'CreateAlerts1762800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "alerts_severity_enum" AS ENUM ('low', 'medium', 'high', 'critical')`,
    );
    await queryRunner.query(
      `CREATE TYPE "alerts_status_enum" AS ENUM ('open', 'acknowledged', 'resolved')`,
    );
    await queryRunner.query(`
      CREATE TABLE "alerts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" varchar(200) NOT NULL,
        "severity" "alerts_severity_enum" NOT NULL,
        "type" varchar(64) NOT NULL,
        "ipAddress" varchar(45),
        "payload" jsonb NOT NULL DEFAULT '{}',
        "status" "alerts_status_enum" NOT NULL DEFAULT 'open',
        "sourceId" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_alerts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_alerts_sourceId" FOREIGN KEY ("sourceId")
          REFERENCES "sources"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_alerts_createdAt" ON "alerts" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alerts_severity" ON "alerts" ("severity")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alerts_status" ON "alerts" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_alerts_sourceId" ON "alerts" ("sourceId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "alerts"`);
    await queryRunner.query(`DROP TYPE "alerts_status_enum"`);
    await queryRunner.query(`DROP TYPE "alerts_severity_enum"`);
  }
}
