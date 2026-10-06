# Day 1 task sheet — Tejomaya — KenRoute backend foundation

You are building the backend for KenRoute in `D:\me\projects\web\p7 kennytorus` (the repository root **is** the backend). I am in a meeting and cannot answer questions. Work through every task below in order, on your own, until all of them are done and verified. Where something is undecided, take the default written here or the simplest safe choice, note it in the final report, and keep going. Do not stop to ask.

## Read first

1. `prisma/schema.prisma` — 12 tables drafted and validated, not yet migrated.
2. `docs/plans/day1-kavya-agent-app.md`, section "API contract" — the frontend is being built against these exact request and response shapes today. Your endpoints must match them field for field. If a shape is impossible, implement the closest thing and list the difference in the final report; do not silently change it.
3. `docs/plans/ceo-questions.md`, last table — business defaults to build with.
4. `package.json`, `prisma.config.ts`, `tsconfig.json`, `.env` (read variable names only; never print secret values).

## Ground rules

- Stack already installed: Express 5, Prisma 7 (`prisma-client` generator, output `generated/prisma`), PostgreSQL 18 running locally on 5432, zod 4, bcrypt, jsonwebtoken, express-rate-limit, cors, Jest + supertest + ts-jest, ts-node-dev. Server port is `PORT` from `.env` (5000).
- Prisma 7 needs a driver adapter. Install `@prisma/adapter-pg` and `pg`; load the Prisma skills if anything about v7 setup is unclear. You may also add `cookie-parser`. Add no other dependencies without a strong reason; say why in the report.
- Do **not** touch `admin/`, `agent/`, `counductor/` (separate git repositories) or the research folders (`abhibus/`, `redbus/`, `srdv/`, `refernces/`, `reports/`, `session/`).
- Layout: `src/app.ts`, `src/server.ts`, `src/core/*` (config, db, errors, validate, auth, tenant, crypto, audit, pagination), `src/modules/<name>/{routes,service,schema}.ts`, tests next to code as `*.test.ts`.
- API conventions: base path `/api/v1`; JSON; UUID ids; dates ISO 8601 UTC; money as decimal strings (`"1250.00"`), never floats; lists take `?page&limit` and return `{ items, total, page, limit }`; errors are `{ error: { code, message, details } }` with the codes used in Kavya's contract plus `CONFLICT`.
- Security, not optional: bcrypt password hashing; login rate-limited by IP and by email; every route validates input with zod, checks the role, and reads or writes only through the operator-scoped database client; no passwords, tokens, phone numbers or ID numbers in logs; secrets only from environment variables.
- Git: create branch `feature/day1-backend` from the current branch. Commit after each task. Stage explicit paths only — never `git add .` or `git add -A` (the folder holds nested repositories, PDFs and a zip that must stay out). Do not push, do not create a remote.
- Before saying any task is done: run it. `npx tsc --noEmit`, the tests, and a real request against the running server.

## Task 1 — Finish the schema and create the tables

Extend `prisma/schema.prisma` so one migration covers the whole project:

- `Booking`: add `boardingPoint`, `droppingPoint`, `paymentMode` (enum `CASH`, `UPI`), `notes`, optional `offerId`, `discount` (decimal, default 0).
- `Passenger`: add optional unique `boardEventId` (conductor sync idempotency).
- `CommissionLedger`: operator, agent, booking (one per booking), amount, status `PENDING` / `PAID` / `VOID`, optional payout.
- `Payout`: operator, agent, amount, status `REQUESTED` / `PAID` / `REJECTED`, requested and resolved timestamps, note.
- `Offer`: operator, code (unique per operator), title, type `PERCENT` / `FLAT`, value, optional max discount, optional minimum fare, optional usage limit, used count, valid-from, valid-to, active flag.
- `SupportTicket` and `SupportMessage`: operator, raising user, subject, category, priority, status `OPEN` / `PENDING` / `RESOLVED`, optional PNR; messages with author and body.
- `Notification`: operator, optional target user, type, title, body, read timestamp.

Every new table carries `operatorId` and the indexes its obvious queries need. Then:

1. `npx prisma validate`, `npx prisma format`.
2. `npx prisma migrate dev --name init --create-only`, then add by hand to that migration's SQL the partial unique index described in the comment above `model Booking` (one active booking per seat), then apply it.
3. Apply the same migration to the test database (`kenroute_test`; create it if missing) and wire Jest to use it via a separate env var so tests never touch dev data.
4. `npx prisma generate`.

## Task 2 — Server skeleton and shared core

`src/core`: typed config loader that fails fast on a missing variable; Prisma client with the pg adapter; `AppError` class and one error-handling middleware producing the standard error shape (zod errors become `VALIDATION_FAILED` with field paths in `details`; unknown errors become a generic 500 with no internals leaked); `validate(schema)` middleware for body, query and params; pagination helper; request logger that records method, path, status, duration and user id only; AES-256-GCM `encrypt` / `decrypt` with a key-id prefix, plus a keyed hash for phone lookup (add `ENCRYPTION_KEY` and `PHONE_HASH_KEY` to `.env` with generated random values and to a new `.env.example` with placeholders); `audit.log(ctx, action, entity, entityId, meta)`.

`src/app.ts`: JSON body limit, cookie parsing, CORS with credentials for `http://127.0.0.1` and `http://localhost` on ports 3001, 3002, 3003 (list from an env var), `GET /api/v1/health`, module routers, 404 handler, error handler. `src/server.ts` starts it. Add `dev`, `build`, `start`, `test`, `typecheck`, `seed` scripts to `package.json`.

## Task 3 — Authentication

- `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`, `POST /auth/change-password`, shaped exactly as in Kavya's contract.
- Access token: JWT, 15 minutes, claims `userId`, `operatorId`, `role`. Refresh token: random value in an HTTP-only cookie (`sameSite=lax`, `secure` in production, path limited to the auth routes), 7 days, only its hash stored in `RefreshToken`, rotated on every refresh; reuse of a revoked token revokes all of that user's tokens.
- Inactive users and users without a password (drivers) cannot log in. The same error is returned for unknown email and wrong password.
- `requireAuth` and `requireRole(...roles)` middleware.

## Task 4 — Operator scoping

A scoped database client built per request from the token's `operatorId` (Prisma client extension) that injects `operatorId` into every `where` and every `create` for all tenant tables, and makes it impossible to read or update another operator's row by id. All module code receives this client through the request context and never imports the raw client. The raw client is used only by auth lookup, seed and tests.

## Task 5 — Seed

`prisma/seed.ts`, safe to run repeatedly:

- Operator "Sri Krishna Travels" with: owner `owner@srikrishna.test` / `Owner@123`; agents `anil@srikrishna.test` / `Agent@123` (code `AGT1024`, 10%) and one more; conductor `conductor@srikrishna.test` / `Conductor@123`; two drivers (no login). `mustChangePassword` false for seeded users.
- Three channels (own agent, redBus, AbhiBus); three seat layouts (36-seat sleeper with two decks and an aisle, 40-seat 2+2 seater, 30-seat semi-sleeper); three buses; three routes including Hyderabad → Bengaluru with boarding and dropping points; trips for the next seven days with generated seats; about 40 bookings spread over channels and statuses with passengers and commission rows for agent bookings.
- A second operator "Test Travels" with its own owner and one bus, to make isolation visible.

## Task 6 — Staff, seat layouts, buses, routes

All owner-only unless stated.

- `/users`: list (role filter, search, pagination), create (generates a temporary password returned once, `mustChangePassword` true), update, deactivate (revokes refresh tokens), activate, reset password. No hard delete. Agents get code and commission percentage; drivers get licence number.
- `/seat-layouts`: CRUD plus `POST /:id/clone`. Validate the seat array: unique seat numbers, no two seats on one deck/row/col. Editing or deleting a layout used by a bus with future trips returns `CONFLICT`.
- `/buses`: CRUD. Registration unique per operator. Deactivating or deleting a bus with future trips returns `CONFLICT`.
- `/routes`: CRUD. Origin ≠ destination, pair unique per operator. `GET /routes/cities` (owner and agent) returns the distinct city list from active routes.

## Task 7 — Trips

- `POST /trips` (owner): one transaction creating the trip and one `TripSeat` per seat in the bus's layout, all `AVAILABLE`. Fare defaults to the route's base fare. Reject a trip that overlaps another non-cancelled trip of the same bus; reject an inactive bus or route; conductor must have role `CONDUCTOR`, driver role `DRIVER`.
- `GET /trips` (owner; filters: date range, route, bus, status, conductor, driver), `GET /trips/:id` (with seats and seat counts), `PATCH /trips/:id`, `POST /trips/:id/cancel`, `POST /trips/:id/seats/:seatId/block` and `/unblock` (only available seats can be blocked).
- `GET /trips/search?from&to&date` and `GET /trips/:id/seats` (owner and agent) exactly as in Kavya's contract, including `availableSeats`, `heldByMe`, and `passengerGender` only on booked seats. A held seat whose `heldUntil` has passed is reported as `AVAILABLE`. `date` is a calendar day in `Asia/Kolkata`.

## Task 8 — Stretch, only if Tasks 1–7 are done and verified

- `POST /bookings/hold`: lock the seat rows, hold for 5 minutes for this agent, fail with `SEAT_UNAVAILABLE` listing the seats that could not be held.
- `POST /bookings` through one exported `createBooking(ctx, input)` function used by every caller: verify the hold, create one booking per seat sharing one PNR, encrypted passenger phone and ID with phone hash, seat to `BOOKED`, a `PENDING` commission row for agent bookings (fare × the agent's percentage), audit entry — all in one transaction. Response shaped as in Kavya's contract.

## Tests required

1. Login: success, wrong password, inactive user, rate limit, refresh rotation, reuse of a rotated token.
2. Isolation: with two operators, operator A's owner cannot list, read, update or delete operator B's users, layouts, buses, routes or trips — by list and by direct id.
3. Roles: an agent is refused on every owner-only route; a request with no token is refused everywhere except health and login.
4. Trips: creation generates exactly the layout's seat count; overlapping trip rejected; search returns correct available-seat counts.
5. If Task 8 is built: two simultaneous bookings of one seat — exactly one succeeds.

## Final report

When everything is finished, reply with:

1. A table of tasks: done / partly (what is missing) / not done.
2. Test results: the command and the pass/fail counts as actually printed.
3. Every endpoint built, as `METHOD path — roles`.
4. Any difference from Kavya's contract, with the exact field.
5. Every assumption or default you chose.
6. How to run it: the exact commands for install, migrate, seed, start, test, and one sample login request.
7. What is next for Day 2.

State plainly anything that failed or was skipped. Do not describe work as complete unless you ran it and saw it pass.
