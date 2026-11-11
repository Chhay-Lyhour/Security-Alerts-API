import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AlertSeverity } from '../../alerts/entities/alert-severity.enum.js';

@Entity('alert_rules')
export class AlertRule {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 100 })
    name: string;

    // Alert type this rule counts, e.g. `failed_login`. Same format as Alert.type.
    @Index('IDX_alert_rules_type')
    @Column({ type: 'varchar', length: 64 })
    type: string;

    @Column({ type: 'int' })
    threshold: number;

    @Column({ type: 'int' })
    windowSeconds: number;

    // Severity of the escalated alert. Shares the alerts table's enum type.
    @Column({ type: 'enum', enum: AlertSeverity, enumName: 'alerts_severity_enum' })
    severity: AlertSeverity;

    @Column({ type: 'boolean', default: true })
    isEnabled: boolean;

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;
}
