import { ConfigService } from '@nestjs/config';
import { UnrecoverableError } from 'bullmq';
import type { Alert } from '../../alerts/entities/alert.entity.js';
import { AlertSeverity } from '../../alerts/entities/alert-severity.enum.js';
import { AlertStatus } from '../../alerts/entities/alert-status.enum.js';
import { NotificationChannel } from '../entities/notification-channel.enum.js';
import { NotificationSender } from './notification-sender.js';

const TOKEN = '123456789:AAFakeTokenForTests_abc-XYZ';
const CHAT_ID = '-1001234567890';

const makeAlert = (overrides: Partial<Alert> = {}): Alert =>
  ({
    id: 'alert-1',
    title: 'Brute force from 203.0.113.10',
    severity: AlertSeverity.HIGH,
    type: 'brute_force',
    ipAddress: '203.0.113.10',
    payload: {},
    status: AlertStatus.OPEN,
    sourceId: 'src-1',
    createdAt: new Date('2026-11-12T01:00:00Z'),
    ...overrides,
  }) as Alert;
const alert = makeAlert();

const senderWith = (env: Record<string, string>) =>
  new NotificationSender(new ConfigService(env));

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('NotificationSender: Telegram', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('enabledChannels', () => {
    it('includes Telegram when both the token and chat id are set', () => {
      const sender = senderWith({
        TELEGRAM_BOT_TOKEN: TOKEN,
        TELEGRAM_CHAT_ID: CHAT_ID,
      });
      expect(sender.enabledChannels()).toEqual([NotificationChannel.TELEGRAM]);
    });

    it.each([
      [{ TELEGRAM_BOT_TOKEN: TOKEN }],
      [{ TELEGRAM_CHAT_ID: CHAT_ID }],
      [{ TELEGRAM_BOT_TOKEN: '  ', TELEGRAM_CHAT_ID: CHAT_ID }],
    ])('leaves Telegram off when a setting is missing: %o', (env) => {
      expect(senderWith(env).enabledChannels()).not.toContain(
        NotificationChannel.TELEGRAM,
      );
    });
  });

  describe('send', () => {
    const sender = () =>
      senderWith({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT_ID });

    it('posts the alert to the chat through the bot API', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, result: {} }));

      await sender().send(NotificationChannel.TELEGRAM, alert);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string);
      expect(body.chat_id).toBe(CHAT_ID);
      expect(body.text).toMatch(
        /^🟠 \[HIGH\] Brute force from 203\.0\.113\.10/,
      );
      expect(body.text).toContain('IP: 203.0.113.10');
      expect(body.text).toContain('Alert ID: alert-1');
    });

    it('uses a red icon for critical alerts', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

      await sender().send(
        NotificationChannel.TELEGRAM,
        makeAlert({ severity: AlertSeverity.CRITICAL }),
      );

      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.text.startsWith('🔴')).toBe(true);
    });

    it("keeps messages within Telegram's 4096-character limit", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

      await sender().send(
        NotificationChannel.TELEGRAM,
        makeAlert({ title: 'x'.repeat(5000) }),
      );

      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.text.length).toBeLessThanOrEqual(4096);
    });

    it('gives up (no retry) on a wrong chat id, and keeps the token out of the error', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(400, {
          ok: false,
          description: 'Bad Request: chat not found',
        }),
      );

      const error = await sender()
        .send(NotificationChannel.TELEGRAM, alert)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnrecoverableError);
      expect((error as Error).message).toContain('chat not found');
      expect((error as Error).message).not.toContain(TOKEN);
    });

    it('gives up (no retry) on a wrong token', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(401, { ok: false, description: 'Unauthorized' }),
      );

      await expect(
        sender().send(NotificationChannel.TELEGRAM, alert),
      ).rejects.toBeInstanceOf(UnrecoverableError);
    });

    it.each([429, 500, 502])(
      'throws a retryable error on %i',
      async (status) => {
        fetchMock.mockResolvedValue(
          jsonResponse(status, { ok: false, description: 'try later' }),
        );

        const error = await sender()
          .send(NotificationChannel.TELEGRAM, alert)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(UnrecoverableError);
      },
    );

    it('refuses to send when Telegram is not configured', async () => {
      await expect(
        senderWith({}).send(NotificationChannel.TELEGRAM, alert),
      ).rejects.toBeInstanceOf(UnrecoverableError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
