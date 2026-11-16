import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTelegramChannel1794360000000 implements MigrationInterface {
  name = 'AddTelegramChannel1794360000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."notification_channel" ADD VALUE IF NOT EXISTS 'telegram'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres cannot drop one value from an enum, so rebuild the type
    // without it. Telegram notification records are removed first.
    await queryRunner.query(
      `DELETE FROM "notifications" WHERE "channel" = 'telegram'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."notification_channel" RENAME TO "notification_channel_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notification_channel" AS ENUM('email', 'slack', 'discord')`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ALTER COLUMN "channel" TYPE "public"."notification_channel" USING "channel"::text::"public"."notification_channel"`,
    );
    await queryRunner.query(`DROP TYPE "public"."notification_channel_old"`);
  }
}
