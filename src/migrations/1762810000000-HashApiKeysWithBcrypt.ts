import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * API keys move from SHA-256 to bcrypt, with a plain-text prefix for lookup.
 * Keys issued before this migration have no prefix, so they stop working:
 * create those sources again to get new keys.
 */
export class HashApiKeysWithBcrypt1762810000000 implements MigrationInterface {
  name = 'HashApiKeysWithBcrypt1762810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sources" DROP CONSTRAINT "UQ_sources_apiKeyHash"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sources" ALTER COLUMN "apiKeyHash" TYPE varchar(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "sources" ADD "apiKeyPrefix" varchar(16)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sources_apiKeyPrefix" ON "sources" ("apiKeyPrefix")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_sources_apiKeyPrefix"`);
    await queryRunner.query(`ALTER TABLE "sources" DROP COLUMN "apiKeyPrefix"`);
    // bcrypt hashes do not fit back into char(64). Keep the sources (alerts
    // point at them) but give them an unguessable placeholder and turn them off.
    await queryRunner.query(`
      UPDATE "sources"
      SET "apiKeyHash" = encode(sha256(gen_random_uuid()::text::bytea), 'hex'),
          "isActive" = false
      WHERE length("apiKeyHash") <> 64
    `);
    await queryRunner.query(
      `ALTER TABLE "sources" ALTER COLUMN "apiKeyHash" TYPE char(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "sources" ADD CONSTRAINT "UQ_sources_apiKeyHash" UNIQUE ("apiKeyHash")`,
    );
  }
}
