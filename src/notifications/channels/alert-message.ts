import type { Alert } from '../../alerts/entities/alert.entity.js';

// Plain-text summary of an alert, shared by every channel.
export function formatAlertMessage(alert: Alert): { subject: string; body: string } {
    const subject = `[${alert.severity.toUpperCase()}] ${alert.title}`;
    const lines = [
        subject,
        `Type: ${alert.type}`,
        `Severity: ${alert.severity}`,
        alert.ipAddress ? `IP: ${alert.ipAddress}` : null,
        `Alert ID: ${alert.id}`,
        `Created: ${new Date(alert.createdAt).toISOString()}`,
    ];
    return { subject, body: lines.filter((l): l is string => l !== null).join('\n') };
}
