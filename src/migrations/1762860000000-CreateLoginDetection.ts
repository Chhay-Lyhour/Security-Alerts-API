import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Login detection: devices, login attempts and lockouts (SPECS.md sections 6-7). */
export class CreateLoginDetection1762860000000 implements MigrationInterface {
  name = 'CreateLoginDetection1762860000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "devices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "fingerprint" varchar(64) NOT NULL,
        "name" varchar(100) NOT NULL,
        "ipAddress" varchar(45) NOT NULL,
        "location" varchar(2),
        "firstSeenAt" timestamptz NOT NULL,
        "lastSeenAt" timestamptz NOT NULL,
        "isTrusted" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_devices_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_devices_userId_fingerprint" UNIQUE ("userId", "fingerprint"),
        CONSTRAINT "FK_devices_userId" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "login_attempts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid,
        "email" varchar(255) NOT NULL,
        "ip" varchar(45) NOT NULL,
        "country" varchar(2),
        "deviceFingerprint" varchar(64) NOT NULL,
        "userAgent" varchar(512) NOT NULL DEFAULT '',
        "success" boolean NOT NULL,
        "emailExists" boolean NOT NULL,
        "blocked" boolean NOT NULL DEFAULT false,
        "riskScore" integer NOT NULL DEFAULT 0,
        "riskLevel" varchar(10) NOT NULL DEFAULT 'none',
        "signals" jsonb NOT NULL DEFAULT '[]',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_login_attempts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_login_attempts_userId" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    // The detection rules count recent attempts per email, per IP and per user.
    await queryRunner.query(
      `CREATE INDEX "IDX_login_attempts_email_createdAt" ON "login_attempts" ("email", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_login_attempts_ip_createdAt" ON "login_attempts" ("ip", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_login_attempts_userId_createdAt" ON "login_attempts" ("userId", "createdAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE "lockouts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "targetType" varchar(5) NOT NULL,
        "target" varchar(255) NOT NULL,
        "ip" varchar(45) NOT NULL,
        "reason" varchar(40) NOT NULL,
        "lockedUntil" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lockouts_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_lockouts_target_lockedUntil" ON "lockouts" ("target", "lockedUntil")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "lockouts"`);
    await queryRunner.query(`DROP TABLE "login_attempts"`);
    await queryRunner.query(`DROP TABLE "devices"`);
  }
}
