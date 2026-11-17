# Deploying to Render (free)

`render.yaml` describes everything Render needs: the API (built from the
`Dockerfile`), a Postgres database and a Redis instance, all on the free plan.
No credit card is required.

## Free-plan limits

| Limit | What it means |
|---|---|
| The API sleeps after 15 minutes with no requests | The next request takes about a minute while it wakes up. Callers should allow a long timeout, or fail open. |
| The free database expires 30 days after creation | Before then, upgrade it or create a new one (and seed it again). |
| 512 MB RAM for the API | Enough for this project. |

## 1. Create the services

1. Sign up at <https://render.com> with your GitHub account.
2. **New → Blueprint**, pick this repository and the `main` branch.
3. Render reads `render.yaml` and lists three resources. For `CORS_ORIGINS`,
   leave it empty unless a browser app calls the API directly.
4. Click **Deploy Blueprint**. The first build takes a few minutes.
   Migrations run automatically when the API starts.
5. When it's live, open `https://<your-service>.onrender.com/health`. It should
   answer `{"status":"ok",...}`.

## 2. Create the first admin

Admins are not created over HTTP. Seed one from your laptop against the Render
database:

1. In Render, open **security-alerts-db → Connect → External** and note the
   host, port, database, user and password.
2. From the project folder (your local `.env` provides `JWT_SECRET`):

   ```bash
   PGSSLMODE=no-verify \
   DATABASE_HOST=<external host> \
   DATABASE_PORT=5432 \
   DATABASE_USER=<user> \
   DATABASE_PASSWORD=<password> \
   DATABASE_NAME=security_alerts \
   npm run seed:admin
   ```

   Use a strong password, not the demo one.

## 3. Connect a client

Log in as the admin and create a source for each integrating app:

```
POST https://<your-service>.onrender.com/auth/login
POST https://<your-service>.onrender.com/sources    { "name": "learning-platform" }
```

The response contains the API key, shown once. Send it privately to the team
that owns the app, along with the base URL. Then create their rules with
`POST /rules`, as on the local setup.

## Updating

Every push to `main` redeploys automatically.
