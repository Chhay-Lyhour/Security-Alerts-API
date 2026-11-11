import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateNotifications1794330000000 implements MigrationInterface {
    name = 'CreateNotifications1794330000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."notification_channel" AS ENUM('email', 'slack', 'discord')`);
        await queryRunner.query(`CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed')`);
        await queryRunner.query(`CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "alertId" uuid NOT NULL, "channel" "public"."notification_channel" NOT NULL, "status" "public"."notification_status" NOT NULL DEFAULT 'pending', "attempts" integer NOT NULL DEFAULT 0, "lastError" text, "sentAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_notifications_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_notifications_alertId" ON "notifications" ("alertId") `);
        await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "FK_notifications_alertId" FOREIGN KEY ("alertId") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "FK_notifications_alertId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_notifications_alertId"`);
        await queryRunner.query(`DROP TABLE "notifications"`);
        await queryRunner.query(`DROP TYPE "public"."notification_status"`);
        await queryRunner.query(`DROP TYPE "public"."notification_channel"`);
    }

}
