import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuditOutcome } from './audit-outcome.enum.js';

/**
 * One privileged action: who did what, to which record, from where, and
 * whether it was allowed.
 *
 * There is deliberately no foreign key to `users`: the trail must survive
 * the user being deleted, so the actor's email and role are copied onto the
 * row. A database trigger (see the CreateAuditLogs migration) rejects UPDATE
 * and DELETE, so rows can only be added.
 */
@Entity('audit_logs')
@Index('IDX_audit_logs_userId_createdAt', ['userId', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Null for actions the system took on its own (e.g. an automatic IP block). */
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actorEmail: string | null;

  /** `admin`, `analyst`, or `system`. */
  @Column({ type: 'varchar', length: 20 })
  actorRole: string;

  /** e.g. `acknowledged_alert`, `created_rule`, `access_denied`. */
  @Index('IDX_audit_logs_action')
  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ type: 'enum', enum: AuditOutcome, enumName: 'audit_outcome' })
  outcome: AuditOutcome;

  /** e.g. `alert`, `rule`, `source`, `device`, `blocked_ip`. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  targetType: string | null;

  @Index('IDX_audit_logs_targetId')
  @Column({ type: 'varchar', length: 64, nullable: true })
  targetId: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  method: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  path: string | null;

  @Column({ type: 'integer', nullable: true })
  statusCode: number | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string | null;

  /** Extra detail, such as the requested status or the fields a rule changed. Never secrets. */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  metadata: Record<string, unknown>;

  @Index('IDX_audit_logs_createdAt')
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
