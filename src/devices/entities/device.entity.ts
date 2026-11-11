import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  type Relation,
} from 'typeorm';
import { User } from '../../users/entities/user.entity.js';

@Entity('devices')
@Unique(['userId', 'fingerprint'])
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: Relation<User>;

  /** SHA-256 of browser + OS + device type (+ client device ID when sent). */
  @Column({ type: 'varchar', length: 64 })
  fingerprint: string;

  /** Human-readable label, e.g. "Chrome on Windows". */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Last IP this device logged in from. */
  @Column({ type: 'varchar', length: 45 })
  ipAddress: string;

  /** Last known country (ISO 3166-1 alpha-2), when available. */
  @Column({ type: 'varchar', length: 2, nullable: true })
  location: string | null;

  @Column({ type: 'timestamptz' })
  firstSeenAt: Date;

  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;

  @Column({ type: 'boolean', default: false })
  isTrusted: boolean;
}
