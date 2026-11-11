import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { NotificationChannel } from "./notification-channel.enum.js";
import { NotificationStatus } from "./notification-status.enum.js";
import { Alert } from "../../alerts/entities/alert.entity.js";

@Entity('notifications')
export class Notification {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index('IDX_notifications_alertId')
    @Column({ type: 'uuid' })
    alertId: string;

    @Column({ type: 'enum', enum: NotificationChannel, enumName: 'notification_channel' })
    channel: NotificationChannel;

    @Column({ type: 'enum', enum: NotificationStatus, enumName: 'notification_status', default: NotificationStatus.PENDING })
    status: NotificationStatus;

    // How many delivery attempts the worker has made so far. 
    @Column({ type: 'int', default: 0 })
    attempts: number;

    // Error message from the most recent failed attempt.
    @Column({ type: 'text', nullable: true })
    lastError: string | null;

    @Column({ type: 'timestamptz', nullable: true })
    sentAt: Date | null;

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date;

    @ManyToOne(() => Alert, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'alertId', foreignKeyConstraintName: 'FK_notifications_alertId' })
    alert: Alert;
}
