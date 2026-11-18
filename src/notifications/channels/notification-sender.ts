import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnrecoverableError } from 'bullmq';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Alert } from '../../alerts/entities/alert.entity.js';
import { NotificationChannel } from '../entities/notification-channel.enum.js';
import { type AlertMessageOptions, formatAlertMessage } from './alert-message.js';

const WEBHOOK_TIMEOUT_MS = 10_000;
const TELEGRAM_API = 'https://api.telegram.org';
// Telegram rejects messages longer than 4096 characters.
const TELEGRAM_MAX_LENGTH = 4096;
const SEVERITY_ICONS: Record<string, string> = {
    low: '🔵',
    medium: '🟡',
    high: '🟠',
    critical: '🔴',
};

// Delivers an alert over email (SMTP), Slack or Discord (incoming webhooks), or Telegram (bot API).
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
        if (this.telegramSettings()) channels.push(NotificationChannel.TELEGRAM);
        return channels;
    }

    async send(channel: NotificationChannel, alert: Alert): Promise<void> {
        switch (channel) {
            case NotificationChannel.EMAIL:
                return this.sendEmail(alert);
            case NotificationChannel.SLACK:
                return this.postWebhook('SLACK_WEBHOOK_URL', { text: formatAlertMessage(alert, this.messageOptions()).body });
            case NotificationChannel.DISCORD:
                // Discord caps message content at 2000 characters.
                return this.postWebhook('DISCORD_WEBHOOK_URL', {
                    content: formatAlertMessage(alert, this.messageOptions()).body.slice(0, 2000),
                });
            case NotificationChannel.TELEGRAM:
                return this.sendTelegram(alert);
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

        const { subject, body } = formatAlertMessage(alert, this.messageOptions());
        await this.mailer.sendMail({ from: settings.from, to: settings.to, subject, text: body });
    }

    // Sends the alert to a Telegram chat through the bot's sendMessage method.
    private async sendTelegram(alert: Alert): Promise<void> {
        const settings = this.telegramSettings();
        if (!settings) throw new UnrecoverableError('Telegram channel is not configured');

        const icon = SEVERITY_ICONS[alert.severity] ?? '⚠️';
        const text = `${icon} ${formatAlertMessage(alert, this.messageOptions()).body}`.slice(0, TELEGRAM_MAX_LENGTH);
        // The token is part of the URL, so it must never appear in errors or logs.
        await this.postJson(
            `${TELEGRAM_API}/bot${settings.token}/sendMessage`,
            { chat_id: settings.chatId, text, disable_web_page_preview: true },
            'Telegram',
        );
    }

    private async postWebhook(key: string, body: Record<string, unknown>): Promise<void> {
        const url = this.value(key);
        if (!url) throw new UnrecoverableError(`${key} is not configured`);
        await this.postJson(url, body, 'Webhook');
    }

    private async postJson(url: string, body: Record<string, unknown>, label: string): Promise<void> {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });
        if (!response.ok) {
            const message = `${label} responded ${response.status} ${response.statusText}${await errorDetail(response)}`;
            // 4xx other than 408/429 means the request itself is wrong (bad URL,
            // deleted webhook): retrying will not help.
            const permanent = response.status >= 400 && response.status < 500
                && response.status !== 408 && response.status !== 429;
            throw permanent ? new UnrecoverableError(message) : new Error(message);
        }
    }

    private messageOptions(): AlertMessageOptions {
        return {
            autoBlockMinutes: Number(this.value('FIREWALL_AUTO_BLOCK_MINUTES') ?? 60),
            // Render sets RENDER_EXTERNAL_URL on every web service.
            baseUrl: this.value('PUBLIC_URL') ?? this.value('RENDER_EXTERNAL_URL'),
        };
    }

    private telegramSettings() {
        const token = this.value('TELEGRAM_BOT_TOKEN');
        const chatId = this.value('TELEGRAM_CHAT_ID');
        return token && chatId ? { token, chatId } : null;
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

// Telegram explains failures in a JSON "description" (e.g. "chat not found").
// Webhooks may answer with plain text, which is ignored.
async function errorDetail(response: Response): Promise<string> {
    try {
        const body = (await response.json()) as { description?: unknown };
        return typeof body.description === 'string' ? `: ${body.description.slice(0, 200)}` : '';
    } catch {
        return '';
    }
}
