# Security Alerts API

A backend service for logging security alerts, built with **NestJS**, **PostgreSQL** and **BullMQ/Redis**.

> **Status:** early development. Only the project scaffold is in place. For features, routes and detection rules, see [`SPECS.md`](./SPECS.md).

## Requirements

Install these before you start:

| Tool | Version | Used for |
|---|---|---|
| [Node.js](https://nodejs.org) | 22 or newer | Running the API |
| [PostgreSQL](https://www.postgresql.org/download/) | 14 or newer | Main database |
| [Redis](https://redis.io/docs/latest/operate/oss_and_stack/install/) | 6 or newer | Job queue (BullMQ) |

Check your Node.js version with `node -v`.

> **Tip:** if you have [Docker](https://www.docker.com/), you can skip installing PostgreSQL and Redis and run them in containers instead:
>
> ```bash
> docker run -d --name security-alerts-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=security_alerts -p 5432:5432 postgres:16
> docker run -d --name security-alerts-redis -p 6379:6379 redis:7
> ```
>
> The database `security_alerts` is created for you, so you can skip step 3 below.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create your `.env` file

The app reads its settings from a `.env` file in the project root. Copy the example file:

```bash
cp .env.example .env
```

Then open `.env` and set the values for your machine:

| Variable | Example | What it is |
|---|---|---|
| `NODE_ENV` | `development` | Environment name |
| `PORT` | `3000` | Port the API listens on |
| `DATABASE_HOST` | `localhost` | Where PostgreSQL is running |
| `DATABASE_PORT` | `5432` | PostgreSQL port |
| `DATABASE_USER` | `postgres` | PostgreSQL username |
| `DATABASE_PASSWORD` | `postgres` | PostgreSQL password (**you must change this**) |
| `DATABASE_NAME` | `security_alerts` | Name of the database the app uses |
| `REDIS_HOST` | `localhost` | Where Redis is running |
| `REDIS_PORT` | `6379` | Redis port |

> Never commit `.env`. It holds your passwords. Only `.env.example` belongs in git.

### 3. Create the database

PostgreSQL does not create the database for you. Create it once:

```bash
createdb -U postgres security_alerts
```

Or, from `psql`: `CREATE DATABASE security_alerts;`

### 4. Run database migrations

Migrations create and update the database tables. Run this after the first setup and every time you pull new changes:

```bash
npm run migration:run
```

### 5. Start the API

```bash
npm run start:dev
```

This starts the API in watch mode, so it restarts when you save a file.

### 6. Check that it works

Open [http://localhost:3000](http://localhost:3000) in your browser, or run:

```bash
curl http://localhost:3000
```

You should see `Hello World!`.

## Scripts

| Script | Description |
|---|---|
| `npm run start:dev` | Start in watch mode (use this for development) |
| `npm run build` then `npm run start:prod` | Build and run for production |
| `npm run test` | Unit tests |
| `npm run test:e2e` | End-to-end tests |
| `npm run lint` | Check code for problems |
| `npm run format` | Format code with Prettier |
| `npm run migration:run` | Apply pending migrations |
| `npm run migration:revert` | Undo the last migration |
| `npm run migration:show` | List applied and pending migrations |
| `npm run migration:generate -- src/database/migrations/<Name>` | Create a migration from entity changes |

## License

UNLICENSED, private project.
