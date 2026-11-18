# Analyst console

A web page served by the API itself at **`/dashboard/`**: no separate app, no build step, no CORS. It's three static files in [`public/dashboard/`](../public/dashboard) that call the same API routes as Postman.

| Where | URL |
|---|---|
| Local (Docker) | http://localhost:3000/dashboard/ |
| Live (Render) | https://security-alerts-api.onrender.com/dashboard/ |

## Who can use it

| Role | Can |
|---|---|
| **Analyst** | See everything except users and the audit trail; acknowledge and resolve alerts |
| **Admin** | Also create accounts and change roles, block and unblock IPs, lift login lockouts, turn rules on and off, delete alerts, read the audit trail |

There is no public sign-up. An admin creates every account in the **Users** tab (or with `POST /users`) and shares the password privately. The very first admin is created with `npm run seed:admin`.

Every admin action from the console goes through the same routes as before, so it's checked by role and recorded in the audit trail, including refused attempts.

## What each view shows

**Live** is the one to present. It refreshes every 4 seconds and follows one attack across three columns:

| Column | Shows | Comes from |
|---|---|---|
| **01 Detect** | Events reported by connected apps (`POST /alerts`), and sign-ins the login engine flagged | `GET /alerts`, `GET /detection/login-attempts?flagged=true` |
| **02 Score** | *Rule progress*: for each enabled rule, how many matching events each IP has inside the rule's window (for example `3 / 5 failed_login in 1 min`). At the threshold the rule fires. Below that: rules that fired, and the login engine's risk score per sign-in | `GET /rules` plus the alerts above; escalated alerts (`payload.ruleId`) |
| **03 Protect** | IPs the firewall refuses (automatic or manual, with a countdown) and emails or IPs the login engine locked | `GET /firewall/blocked-ips`, `GET /detection/lockouts` |

A notification pops up when a rule fires, an IP is blocked or a login is locked. **Click any IP** to open its story: every event, score and block for that address in time order, with Block or Unblock.

The other tabs:

- **Alerts**: filter by source, severity, status, type and IP; acknowledge, resolve, open the payload.
- **Firewall**: active blocks; admins add a block (an IP or range, optional minutes) or lift one.
- **Login engine**: how a score is built (each fired rule adds low 10, medium 25, high 50, critical 100), active lockouts, and every attempt with the rules that fired.
- **Rules**: alert rules for connected apps (admins can turn them on and off) and the nine login detection rules with their live thresholds.
- **Users** (admins): create accounts, change roles and delete accounts. You can't change or delete your own.
- **Audit** (admins): the append-only trail.

## Show it working

Locally, with the Docker stack running and `npm run demo:setup` done:

1. Open http://localhost:3000/dashboard/ and sign in as the admin.
2. In another window, open the bank at http://localhost:4000 and enter a wrong password for `dara` five times, with the same IP in the "simulated IP" field.
3. Watch Live: five `failed_login` events appear in Detect, the rule meter fills `1 / 5` … `5 / 5` and fires in Score, and the IP appears in Protect. The bank now refuses that IP.
4. Click the IP to show the whole story, then **Unblock**. The audit trail records both the automatic block and your unblock.

Against the live server, the same thing happens when a connected app (for example Nek Rean IT) reports wrong passwords.

## How it's built

- `index.html`, `app.css`, `app.js` in `public/dashboard/`, served by `app.useStaticAssets()` in `main.ts`. The Dockerfile copies `public/` into the image.
- Signs in with `POST /auth/login` and keeps the access and refresh tokens in `sessionStorage` (gone when the tab closes). On a 401 it refreshes once, then asks to sign in again.
- Helmet's content security policy stays strict: scripts only from this origin, nothing inline. Every value from the server is escaped before it's shown.
- Analysts can read sources (names only, never keys), rules and blocked IPs so the console can label and score events; only admins can change them.
- Alerts raised by the login engine (source `login-detection-engine`) are left out of the Live view's Detect column, because the same sign-in is already shown there as a scored attempt. They're in the Alerts tab.
