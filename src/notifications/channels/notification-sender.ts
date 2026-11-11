import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnrecoverableError } from 'bullmq';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Alert } from '../../alerts/entities/alert.entity.js';
import { NotificationChannel } from '../entities/notification-channel.enum.js';
import { formatAlertMessage } from './alert-message.js';

const WEBHOOK_TIMEOUT_MS = 10_000;

// Delivers an alert over email (SMTP), Slack or Discord (incoming webhooks).
// A channel is enabled when its settings are present in the environment.
// Throws on failure so BullMQ retries the job. A channel that is not configured throws UnrecoverableError, because retrying cannot fix it.
@Injectable()
export class NotificationSender {
    private mailer: Transporter | null = null;

    constructor(private readonly config: ConfigService) {}

    enabledChannels(): NotificationChannel[] {
        const channels: NotificationChannel[] = [];
        if (this.emailSettings()) channels.push(NotificationChannel.EMAIL);
        if (this.value('SLACK_WEBHOOK_URL')) channels.push(NotificationChannel.SLACK);
        if (this.value('DISCORD_WEBHOOK_URL')) channels.push(NotificationChannel.DISCORD);
        return channels;
    }

    async send(channel: NotificationChannel, alert: Alert): Promise<void> {
        switch (channel) {
            case NotificationChannel.EMAIL:
                return this.sendEmail(alert);
            case NotificationChannel.SLACK:
                return this.postWebhook('SLACK_WEBHOOK_URL', { text: formatAlertMessage(alert).body });
            case NotificationChannel.DISCORD:
                // Discord caps message content at 2000 characters.
                return this.postWebhook('DISCORD_WEBHOOK_URL', {
                    content: formatAlertMessage(alert).body.slice(0, 2000),
                });
            default:
                throw new UnrecoverableError(`Unknown notification channel: ${String(channel)}`);
        }
    }

    private async sendEmail(alert: Alert): Promise<void> {
        const settings = this.emailSettings();
        if (!settings) throw new UnrecoverableError('Email channel is not configured');

        this.mailer ??= nodemailer.createTransport({
            host: settings.host,
            port: settings.port,
            secure: settings.port === 465,
            auth: settings.user ? { user: settings.user, pass: settings.pass } : undefined,
        });

        const { subject, body } = formatAlertMessage(alert);
        await this.mailer.sendMail({ from: settings.from, to: settings.to, subject, text: body });
    }

    private async postWebhook(key: string, body: Record<string, unknown>): Promise<void> {
        const url = this.value(key);
        if (!url) throw new UnrecoverableError(`${key} is not configured`);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });
        if (!response.ok) {
            const message = `Webhook responded ${response.status} ${response.statusText}`;
            // 4xx other than 408/429 means the request itself is wrong (bad URL,
            // deleted webhook): retrying will not help.
            const permanent = response.status >= 400 && response.status < 500
                && response.status !== 408 && response.status !== 429;
            throw permanent ? new UnrecoverableError(message) : new Error(message);
        }
    }

    private emailSettings() {
        const host = this.value('SMTP_HOST');
        const to = this.value('ALERT_EMAIL_TO');
        if (!host || !to) return null;
        return {
            host,
            to,
            port: Number(this.value('SMTP_PORT') ?? 587),
            user: this.value('SMTP_USER'),
            pass: this.value('SMTP_PASSWORD'),
            from: this.value('ALERT_EMAIL_FROM') ?? 'security-alerts@localhost',
        };
    }

    private value(key: string): string | undefined {
        const raw = this.config.get<string>(key);
        const trimmed = typeof raw === 'string' ? raw.trim() : raw;
        return trimmed ? String(trimmed) : undefined;
    }
}
