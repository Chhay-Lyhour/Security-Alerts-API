import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Source } from '../../sources/entities/source.entity.js';
import { AlertSeverity } from './alert-severity.enum.js';
import { AlertStatus } from './alert-status.enum.js';

@Entity('alerts')
export class Alert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Index('IDX_alerts_severity')
  @Column({
    type: 'enum',
    enum: AlertSeverity,
  })
  severity: AlertSeverity;

  /** Machine-readable kind, e.g. `failed_login` or `port_scan`. Rules match on it. */
  @Column({ type: 'varchar', length: 64 })
  type: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  /** Whatever extra detail the source sent. */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  payload: Record<string, unknown>;

  @Index('IDX_alerts_status')
  @Column({
    type: 'enum',
    enum: AlertStatus,
    default: AlertStatus.OPEN,
  })
  status: AlertStatus;

  @Index('IDX_alerts_sourceId')
  @Column({ type: 'uuid' })
  sourceId: string;

  @ManyToOne(() => Source, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'sourceId',
    foreignKeyConstraintName: 'FK_alerts_sourceId',
  })
  source?: Source;

  @Index('IDX_alerts_createdAt')
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
