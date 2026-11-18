# Telegram notifications

The API can send alerts to a Telegram group or channel through a bot. It runs alongside the email, Slack and Discord channels: every channel whose settings are present gets its own notification job.

## What sends a notification

Not every event. Only the moments someone should look at:

| Trigger | Example message heading |
|---|---|
| An **alert rule fires** for a connected app (5 `failed_login` from one IP in 60 s) | `🟠 [HIGH] Rule "Lotus: 5 failed logins in 60s": …` |
| The **login engine** scores a sign-in to this API HIGH or CRITICAL | `🟠 [HIGH] Login engine: Brute force: 20 for this email …` |

Single events and LOW/MEDIUM logins are stored and shown on the dashboard, but don't notify.

```
Event → saved → rule or login engine decides it matters
      → one Notification row + BullMQ job per channel (Redis)
      → worker sends it; on failure retries after 5 s, then 10 s
      → status sent, or failed with the provider's error after 3 tries
```

The API answers the caller before any of this runs, so a slow provider never slows down ingest or login.

A message says what was detected, how it was scored and what the system did:

```
🟠 [HIGH] Rule "Lotus: 5 failed logins in 60s": 5 failed_login alerts in 60s
Source: lotus-demo-bank
Type: failed_login
IP: 198.51.100.9
Rule: Lotus: 5 failed logins in 60s (5 of 5 in 60s)
Response: IP blocked by the firewall for 60 min
Alert ID: 2392753f-…
Created: 2026-11-12T01:52:10.000Z
Dashboard: https://security-alerts-api.onrender.com/dashboard/
```

The dashboard link uses `PUBLIC_URL`, or Render's `RENDER_EXTERNAL_URL` automatically.

The icon shows the severity: 🔵 low, 🟡 medium, 🟠 high, 🔴 critical.

## Setup (about 5 minutes)

### 1. Create the bot

In Telegram, open **@BotFather**, send `/newbot`, and pick a name and a username ending in `bot`. BotFather replies with a token like `1234567890:AAH...`. Treat it like a password and never commit it.

Lost the token? In @BotFather open **My Bots**, pick your bot, then **API Token**. You don't need to change anything else in BotFather's menus (Edit Info, Commands, Mini Apps and so on).

### 2. Pick where alerts go

**Option A: a group (recommended for a team)**

1. Create a group (e.g. "Security Alerts") and add your bot as a member.
2. In the group, send `/start@your_bot_username`. By default a bot in a group only sees commands, so a plain `hi` will not show up in step 3.

**Option B: just you (private chat)**

Search for your bot, open the chat, press **Start**, and send `hi`.

### 3. Find the chat id

Open this in a browser, with your token after the word `bot` (no `<` `>`, no spaces):

```
https://api.telegram.org/bot1234567890:AAH.../getUpdates
```

Look inside `result[].message.chat`:

```json
"chat": { "id": -1001234567890, "title": "Security Alerts", "type": "supergroup" }
```

- **Group:** `type` is `group` or `supergroup`, and the id is **negative**. Keep the minus sign.
- **Private chat:** `type` is `private`, and the id is your own positive user id.
- Don't use the bot's own id (the number before `:` in the token, or any block with `"is_bot": true`). Telegram answers `403 the bot can't send messages to the bot`.
- `{"ok":true,"result":[]}` means the bot hasn't received anything yet. Send the message from step 2 again and reload. If it's still empty in a group, remove the bot, add it back, and resend the command.
- For a public channel you can use its name instead, like `@my_security_alerts` (add the bot as a channel admin).

### 4. Configure `.env`

```
TELEGRAM_BOT_TOKEN=1234567890:AAH...
TELEGRAM_CHAT_ID=-1001234567890
```

Both must be set, or neither: the app refuses to start if only one is set or the format is wrong. The same "set together" rule applies to `SMTP_HOST` + `ALERT_EMAIL_TO`, so if you only use Telegram, leave both of those empty.

### 5. (Optional) Test the bot by hand

Run this **from the project folder**, so `source .env` finds the file. Paste it as is: the `${...}` parts are filled in from `.env`.

```bash
set -a; source .env; set +a
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" -d text="test from Security API"
```

`"ok":true` means the message was sent. A `404 Not Found` means the token in the URL is empty or wrong (usually the command ran outside the project folder).

### 6. Start the API

`.env` is only read when the container is created, so a plain `restart` is not enough:

```bash
docker compose up -d --force-recreate api
```

Docker runs the migrations on start, which adds `telegram` to the `notification_channel` type. Without Docker, run `npm run migration:run` and then restart the API.

### 7. Trigger a test alert

1. Run `npm run demo:setup` once (creates the demo source, rules and `BANK_API_KEY`).
2. Open the demo bank at http://localhost:4000, set the visitor IP to something like `203.0.113.20`, and sign in as `dara` with a wrong password 5 times.
3. Within a few seconds a 🟠 message arrives in Telegram.

That IP is then auto-blocked for an hour, so use a new IP (`203.0.113.21`, ...) for the next test. Alerts that failed before you fixed the settings are not resent.

## How delivery works

- The rule engine queues one BullMQ job per enabled channel, and `NotificationsProcessor` sends it through `NotificationSender`.
- Each attempt is stored in `notifications` (`channel = 'telegram'`, `status`, `attempts`, `lastError`).
- **Retried** (3 attempts, exponential backoff): network errors, `429 Too Many Requests` and 5xx from Telegram.
- **Not retried**, marked `failed` right away: `400` (e.g. `chat not found`), `401` (wrong token) and `403` (bot was removed from the group). Telegram's reason is saved in `lastError`.
- The bot token is part of the request URL, so it is never written to errors or logs.

## Troubleshooting

Look at the API log first:

```bash
docker compose logs api --since 5m | grep -iE "telegram|notif|error"
```

| Message | Fix |
|---|---|
| `Invalid environment configuration: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set together` | Fill in both, or neither. |
| `Invalid environment configuration: SMTP_HOST and ALERT_EMAIL_TO must be set together` | Not a Telegram problem: empty `ALERT_EMAIL_TO` if you don't use email. |
| `Telegram responded 401 Unauthorized` | Wrong token. Copy it again from @BotFather. |
| `Telegram responded 404 Not Found` | Token missing or mangled in the URL. Check `.env` for spaces, quotes or a missing part. |
| `Telegram responded 400 Bad Request: chat not found` | Wrong chat id, or the bot was never added to that group. |
| `Telegram responded 403 Forbidden: the bot can't send messages to the bot` | `TELEGRAM_CHAT_ID` is the bot's own id. Use the `chat.id` from step 3. |
| `Telegram responded 403 Forbidden: bot was kicked...` | Add the bot back to the group. |
| `fetch failed` | The server can't reach `api.telegram.org` (no internet, firewall or proxy). |
| Messages go to your private chat, not the group | `TELEGRAM_CHAT_ID` is your user id. Use the group's negative id, then recreate the api container. |
| Nothing at all in the log | No alert was escalated. Check that `demo:setup` ran and that the visitor IP isn't already blocked. |

Check recent deliveries with:

```sql
SELECT channel, status, attempts, "lastError", "sentAt" FROM notifications ORDER BY "createdAt" DESC LIMIT 10;
```
