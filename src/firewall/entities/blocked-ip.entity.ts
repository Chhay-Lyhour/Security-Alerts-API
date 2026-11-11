import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BlockOrigin } from './block-origin.enum.js';

/** One blocked address or range. Rows past `expiresAt` stay as history but no longer block. */
@Entity('blocked_ips')
export class BlockedIp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Normalised CIDR, e.g. `203.0.113.7/32`. */
  @Index('IDX_blocked_ips_network')
  @Column({ type: 'varchar', length: 49 })
  network: string;

  @Column({ type: 'varchar', length: 200 })
  reason: string;

  @Column({ type: 'enum', enum: BlockOrigin, enumName: 'block_origin' })
  origin: BlockOrigin;

  /** Admin who added it; null for automatic blocks. */
  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  /** The escalated alert that caused an automatic block. */
  @Column({ type: 'uuid', nullable: true })
  alertId: string | null;

  /** Null means permanent until an admin removes it. */
  @Index('IDX_blocked_ips_expiresAt')
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
