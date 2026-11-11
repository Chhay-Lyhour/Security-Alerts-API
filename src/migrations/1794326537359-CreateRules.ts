import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRules1794326537359 implements MigrationInterface {
    name = 'CreateRules1794326537359';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // "alerts_severity_enum" is created by CreateAlerts1762800000000.
        await queryRunner.query(`
            CREATE TABLE "alert_rules" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "name" varchar(100) NOT NULL,
                "type" varchar(64) NOT NULL,
                "threshold" integer NOT NULL,
                "windowSeconds" integer NOT NULL,
                "severity" "alerts_severity_enum" NOT NULL,
                "isEnabled" boolean NOT NULL DEFAULT true,
                "createdAt" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "PK_alert_rules_id" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_alert_rules_type" ON "alert_rules" ("type")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "alert_rules"`);
    }
}
