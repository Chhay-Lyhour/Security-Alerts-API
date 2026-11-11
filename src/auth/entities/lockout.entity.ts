import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { LockTargetType, LoginSignalType } from '../detection/login-rules.js';

/** A temporary block on an email or an IP address. */
@Entity('lockouts')
@Index(['target', 'lockedUntil'])
export class Lockout {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 5 })
  targetType: LockTargetType;

  /** The locked email (lower-cased) or IP address. */
  @Column({ type: 'varchar', length: 255 })
  target: string;

  /** IP of the attempt that caused the lockout. */
  @Column({ type: 'varchar', length: 45 })
  ip: string;

  /** Rule that caused it, e.g. brute_force. */
  @Column({ type: 'varchar', length: 40 })
  reason: LoginSignalType;

  @Column({ type: 'timestamptz' })
  lockedUntil: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
