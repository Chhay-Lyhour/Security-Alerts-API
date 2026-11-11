import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import type { LoginSignal, RiskLevel } from '../detection/login-rules.js';

/** One row per POST /auth/login. Feeds every login detection rule. */
@Entity('login_attempts')
@Index(['email', 'createdAt'])
@Index(['ip', 'createdAt'])
@Index(['userId', 'createdAt'])
export class LoginAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Null when the email does not belong to any user. */
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: Relation<User> | null;

  /** Email as typed (lower-cased), kept even when no user has it. */
  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 45 })
  ip: string;

  @Column({ type: 'varchar', length: 2, nullable: true })
  country: string | null;

  @Column({ type: 'varchar', length: 64 })
  deviceFingerprint: string;

  @Column({ type: 'varchar', length: 512, default: '' })
  userAgent: string;

  @Column({ type: 'boolean' })
  success: boolean;

  @Column({ type: 'boolean' })
  emailExists: boolean;

  /** Rejected by an active lockout before the password was checked. */
  @Column({ type: 'boolean', default: false })
  blocked: boolean;

  @Column({ type: 'int', default: 0 })
  riskScore: number;

  @Column({ type: 'varchar', length: 10, default: 'none' })
  riskLevel: RiskLevel;

  /** Rules that fired on this attempt (also used to avoid repeat alerts). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  signals: LoginSignal[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
