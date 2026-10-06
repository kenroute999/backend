# KenRoute backend

API server for the three KenRoute apps (Admin, Agent, Conductor). Node.js, TypeScript, Express 5, Prisma 7, PostgreSQL.

## Run it locally

Needs Node.js 22 or newer and PostgreSQL 16 or newer.

```bash
npm install

# 1. Configuration
cp .env.example .env        # then edit .env: database password and two JWT secrets

# 2. Databases (once)
createdb kenroute_dev
createdb kenroute_test

# 3. Tables and demo data
npx prisma migrate deploy
npx prisma generate
npm run seed

# 4. Start
npm run dev                 # http://127.0.0.1:5000/api/v1
```

Check it: open http://127.0.0.1:5000/api/v1/health — it should answer `{"status":"ok"}`.

## Connect a frontend app

In the Admin or Agent app folder, create a file named `.env.local` containing:

```
VITE_API_URL=http://127.0.0.1:5000/api/v1
```

Then restart that app's dev server.

## Demo logins (created by `npm run seed`)

| App | Login | Password |
|---|---|---|
| Admin | `owner@srikrishna.test` | `Owner@123` |
| Agent | `ravi@example.com`, `sai@example.com`, `prasad@example.com` | `Agent@123` |

Conductors sign in with their mobile number; create one from Admin → Conductors.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Start the server, restarting on code changes |
| `npm test` | Run the tests against `kenroute_test` |
| `npm run migrate:test` | Apply migrations to the test database |
| `npm run typecheck` | Type-check without building |
| `npm run seed` | Load demo data (safe to repeat) |
| `npm run studio` | Browse the database in Prisma Studio |

After pulling changes that add a migration: `npx prisma migrate deploy`, `npx prisma generate`, `npm run migrate:test`.

## API

Base path `/api/v1`. JSON. Errors are `{ "error": { "code", "message", "details" } }`. Lists return `{ items, total, page, limit }`.

| Endpoint | Who | Notes |
|---|---|---|
| `POST /auth/login` | anyone | `{ email, password }` for owners and agents; `{ phone, password }` for conductors. Returns `{ accessToken, refreshToken, user }` |
| `POST /auth/refresh` | anyone | `{ refreshToken }` (or the `kr_refresh` cookie). Returns a new pair; the old refresh token stops working |
| `POST /auth/logout` | anyone | `{ refreshToken }`. Revokes it |
| `POST /auth/change-password` | signed in | `{ currentPassword, newPassword }` |
| `GET /me` | signed in | The signed-in account |
| `GET/POST /agents`, `PATCH/DELETE /agents/:id` | owner | |
| `GET/POST /drivers`, `PATCH/DELETE /drivers/:id` | owner | |
| `GET/POST /conductors`, `PATCH/DELETE /conductors/:id` | owner | `PATCH` accepts `tripId` (or `null`) to assign a trip |
| `GET /buses`, `GET /routes` | owner | Read-only for now |
| `GET /trips?busId=` | owner | Upcoming trips |

Signed-in requests send `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes.

## Layout

```
prisma/           schema, migrations, seed
src/core/         config, database client, auth, errors, shared validation
src/modules/      one folder per feature: routes and tests
src/test/         test setup and helpers
docs/             plans, audits and task sheets
```

The `admin/`, `agent/` and `counductor/` folders, if present next to this code, are separate repositories.
