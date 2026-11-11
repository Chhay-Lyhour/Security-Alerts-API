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
@Index('IDX_alerts_severity_status', ['severity', 'status'])
@Entity('alerts')
export class Alert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({
    type: 'enum',
    enum: AlertSeverity,
  })
  severity: AlertSeverity;

  @Column({ type: 'varchar', length: 64 })
  type: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  payload: Record<string, unknown>;

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
