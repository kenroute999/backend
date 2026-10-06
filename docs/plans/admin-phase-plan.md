# KenRoute — Admin phase plan

Date: 2026-10-05 · Team: Tejomaya (lead), Kavya, Harika

All three work on the **Admin app** first. Agent and Conductor follow in later phases and reuse everything built here (database, login, fleet, trips).

Related files:
- Schema: `prisma/schema.prisma` (12 tables, validated, not yet migrated)
- Defect checklist: `docs/audit/admin-audit.md` (17 BIG / 46 MED / 70 SMALL)
- Admin UI: `admin/`, runs on http://127.0.0.1:3001

## 1. Goal

An owner can sign in, add staff, design a seat layout, add a bus and a route, schedule a trip with seats generated, and see bookings and dashboard numbers — all from the real database, with no fake data left in the Admin app.

**Phase is done when:**
1. The demo flow above works end to end on a fresh database plus seed.
2. Every box in `docs/audit/admin-audit.md` is ticked, or marked "deferred" with a reason.
3. No Admin screen reads a hardcoded array.
4. A user from operator A cannot read or change operator B's data, proven by automated tests.

## 2. Who owns what

| | Tejomaya | Kavya | Harika |
|---|---|---|---|
| Theme | Foundation + staff | Fleet | Shell + overview |
| Backend folders | `src/core/*`, `src/modules/auth`, `src/modules/users`, `prisma/` | `src/modules/seat-layouts`, `buses`, `routes`, `trips` | `src/modules/channels`, `bookings`, `dashboard`, `operator` |
| Admin screens | new `/login`, `/agents`, `/drivers` | `/seat-layouts`, `/buses`, `/routes`, new `/trips` | `/`, `/bookings`, `/integrations`, `/reports`, `/settings` |
| Shared frontend | auth store, route guard | — | `admin/src/lib/api.ts`, layout components, shared table parts |

Rule: one owner per folder and per screen file. Nobody edits another person's files without asking. Schema changes go through Tejomaya, one migration per pull request.

## 3. Stages and gates

A gate opens when its check passes, not on a date. Rough size of the whole phase: 8 to 10 working days (estimate, not a commitment).

| Gate | Opens when | Unblocks |
|---|---|---|
| **A0** | Schema reviewed by all three and migrated; API conventions (section 7) agreed | Everyone starts |
| **A1** | Server skeleton, temporary fixed-operator stub, seed data, encryption helper merged (T1, T2, T3) | Kavya's and Harika's APIs can run and be tested |
| **A2** | Login, operator scoping, role guard, sign-in page merged (T4, T5, T6) | Everyone swaps the stub for real login |
| **A3** | Staff API and the fleet chain up to trips done (T7, K1–K5) | A trip can be scheduled with a conductor and driver |
| **A4** | Overview screens on real data (H3–H7), `/trips` screen done (K6) | Full demo flow |
| **A5** | Audit boxes ticked, tenant tests green, demo flow passes | Admin phase closed, Agent phase starts |

How work runs at the same time: until A2, Kavya and Harika use a temporary middleware that pretends every request comes from the seeded owner of the seeded operator. At A2 they change one line to use the real logged-in user. Harika's first two tasks need no backend at all.

## 4. Tejomaya — foundation + staff

In order. T1 to T3 are urgent because the other two are waiting on them.

| # | Task | Details | Audit items closed |
|---|---|---|---|
| T1 | Server skeleton | `src/app.ts`, `src/server.ts`, health endpoint, config from `.env`, CORS for ports 3001/3002/3003, request logger without personal data, uniform error handler, zod validation helper, pagination helper, Prisma client setup, `npm run dev`. Temporary `devTenant` stub middleware. | — |
| T2 | Migration + seed | First migration including the hand-written partial unique index on `Booking.tripSeatId`. Seed: Sri Krishna Travels, 1 owner, 2 agents, 1 conductor, 1 driver, 3 channels, 2 seat layouts, 3 buses, 3 routes, one week of trips with seats, about 40 bookings across all channels. | — |
| T3 | Shared helpers | AES-256-GCM `encrypt`/`decrypt` helper (Harika needs it for channel passwords), phone hash helper, `audit.log()`. | — |
| T4 | Login API | `POST /auth/login` (rate-limited by IP and email), `POST /auth/refresh` (old token revoked, new pair issued), `POST /auth/logout`, `GET /me`, `POST /auth/change-password`. bcrypt hashing. Token carries `userId`, `operatorId`, `role`. Only a hash of the refresh token is stored. | — |
| T5 | Scoping + role guard | `requireAuth`, `requireRole(...)`, and a scoped database client that adds `operatorId` to every read and write. Removes the `devTenant` stub. First cross-operator test. | Global: no auth guard |
| T6 | Sign-in in Admin | New `/login` screen, auth store (access token in memory, refresh in HTTP-only cookie), guard that redirects signed-out users, working Logout, top bar shows real name and role from `/me`, forced password change on first login. | Global: no sign-in page, Logout dead, hardcoded "Super Admin" |
| T7 | Staff API | `GET/POST/PATCH /users` with role filter, search, pagination. Create generates a temporary password. Deactivate revokes refresh tokens. No hard delete. Agents get agent code and commission percentage; drivers get licence number. | — |
| T8 | `/agents` screen | Full build: list, search, add, edit, commission percentage, active toggle, pagination, empty state. | `/agents` section |
| T9 | `/drivers` screen | Full build with two tabs, Drivers and Conductors: list, search, add, edit, active toggle, upcoming trips per person (once K5 lands). | `/drivers` section |
| T10 | Phase close | Cross-operator test suite covering every module, review of everyone's role checks, demo flow run on a fresh database. | — |

## 5. Kavya — fleet

A chain: each task needs the one before it. APIs are owner-only unless noted.

| # | Task | Details | Audit items closed |
|---|---|---|---|
| K1 | Seat layouts API | `GET/POST/PATCH/DELETE /seat-layouts`. Validates the seat array (unique seat numbers, no two seats in one position). A layout used by a bus with future trips cannot be edited; `POST /seat-layouts/:id/clone` instead. | — |
| K2 | `/seat-layouts` screen | Becomes a pure designer: remove live booking status, passenger names and block/release actions (those move to the trip view in K6). Make Layout Type, Add Seat, Remove Seat, Edit Seat Number, New Layout and Save Layout really work. | `/seat-layouts` section, incl. the Release Seat bug |
| K3 | Buses API + `/buses` | `GET/POST/PATCH/DELETE /buses`. Registration unique per operator, format checked. Bus picks a seat layout; seat count comes from the layout. Cannot deactivate a bus with future trips. Screen: Edit, Delete, real pagination, stats from the server. | `/buses` section |
| K4 | Routes API + `/routes` | `GET/POST/PATCH/DELETE /routes`. Required fields enforced, origin ≠ destination, pair unique per operator. Saves boarding points, dropping points, distance, duration, base fare. Bus and departure time are removed from the route form (they belong to trips). Screen: View, Edit, Delete, pagination, free-text city entry. | `/routes` section |
| K5 | Trips API | `POST /trips` in one transaction: create trip, copy the bus's layout into `TripSeat` rows, all AVAILABLE. Rejects overlapping trips for the same bus. `GET /trips` (filters: date, route, bus, status), `GET /trips/:id` with seats, `PATCH /trips/:id` (time, fare, conductor, driver), `POST /trips/:id/cancel`, `POST /trips/:id/seats/:seatId/block` and `/unblock`. Last, if time allows: create a repeating schedule over a date range. | Global: missing trips screen; `/routes` BIG "no trips" |
| K6 | New `/trips` screen | Sidebar entry, trip list with filters, create dialog (bus, route, date and time, fare, conductor, driver), trip detail with the live seat map, block and release seat, cancel trip. | — |

Tests Kavya owns: trip creation generates exactly the layout's seat count; overlapping trips rejected; layout edit blocked when in use; cross-operator checks on all four modules.

## 6. Harika — shell + overview

H1 and H2 need no backend and start immediately.

| # | Task | Details | Audit items closed |
|---|---|---|---|
| H1 | Shell cleanup | Working mobile menu. Top bar: remove global search, calendar and bell for now (see section 9). Add chart and sidebar colours to the theme so they render. Stat card arrow follows the sign of the change. Breadcrumb becomes a link. Remove Lovable leftovers, add favicon, block robots, hide raw error text. | Global: mobile nav, top bar, theme colours, small items |
| H2 | Frontend plumbing | `admin/src/lib/api.ts`: one client that reads the API URL from env, attaches the token, maps error codes to messages. Query-key naming. Shared Pagination, StatusPill and loading/empty/error components, replacing the per-screen copies. Everyone uses these. | Global: fake skeletons, duplicated components |
| H3 | Channels API + `/integrations` | `GET /channels`, `PUT /channels/:id`. Credentials encrypted on the server with the T3 helper and never returned in full. Screen: remove localStorage storage, status comes from the server, add remove-credentials. Connect, Health Check, Refresh and Request New Channel are disabled with a "coming soon" label since real connectors are deferred. | `/integrations` section, incl. plain-text password |
| H4 | Bookings list API + `/bookings` | `GET /bookings` (filters: status, channel, source, agent, trip, date range; search by PNR or exact phone; pagination), `GET /bookings/:id`. Screen wired with real pagination and a real date-range picker. New Booking, Edit and Cancel buttons are hidden in this phase (section 9). | `/bookings` section |
| H5 | Dashboard API + `/` | `GET /dashboard/summary`, `/by-channel`, `/top-routes`, `/trend`. One shared "what counts as revenue" function used by every number. Remove the fake Sync Inventory and Retry buttons; "View All" links go to the real screens. | `/` section, cross-screen contradictions |
| H6 | Reports API + `/reports` | Four groups with a date range: revenue by channel, route performance, agent performance, occupancy. CSV export of the loaded rows in the browser. Remove PDF/Excel export and the six Quick Reports buttons. | `/reports` section |
| H7 | `/settings` | `GET/PUT /operator` for the company profile; own password change using T4's endpoint. Remove links to sections that do not exist and the notification toggles. | `/settings` section |

Tests Harika owns: channel credentials never appear in any API response; bookings filters and pagination; dashboard totals equal the sum of seeded bookings; cross-operator checks on her modules.

## 7. Shared conventions

- Base path `/api/v1`. JSON. UUID ids.
- Dates in ISO 8601 UTC; the app displays them in Asia/Kolkata.
- Money as decimal strings (`"450.00"`), never floats.
- Lists take `?page&limit` and return `{ items, total, page, limit }`.
- Errors: `{ error: { code, message, details } }` with stable codes such as `VALIDATION_FAILED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`.
- Every endpoint: validate input with zod, check role, query only through the scoped database client.
- Backend layout: `src/core/` (shared) and `src/modules/<name>/` with `routes.ts`, `service.ts`, `schema.ts`, `*.test.ts`.
- Frontend: all server data through TanStack Query and `lib/api.ts`. Delete each mock array as its screen is wired.
- Git: commit the current state as a baseline first. Then `feature/<area>-<name>` branches and pull requests, one review each. Tejomaya reviews anything touching auth, scoping or migrations.
- No passwords, tokens, phone numbers or ID proofs in logs.

## 8. Handoffs

| From | To | What | Needed by |
|---|---|---|---|
| Tejomaya | Kavya, Harika | Running server, `devTenant` stub, seed data, error and validation helpers | their first API |
| Tejomaya | Harika | Encryption helper | H3 |
| Tejomaya | Kavya, Harika | `requireAuth`, `requireRole`, scoped database client | gate A2 |
| Harika | Tejomaya, Kavya | `lib/api.ts`, shared table and state components | their first screen |
| Tejomaya | Kavya | Staff list filtered by role (conductor, driver pickers) | K6 |
| Kavya | Tejomaya | Trips list filtered by conductor or driver | T9 |
| Kavya | Harika | Trips and routes data shape for bookings and dashboard queries | H4, H5 |

## 9. Deferred on purpose

| Item | Why | When |
|---|---|---|
| Owner creating, editing or cancelling bookings in Admin | Needs the booking rules (seat hold, commission) built once, in the Agent phase | Agent phase |
| CSV import of redBus/AbhiBus bookings | Calls the same booking function | Agent phase |
| Payout requests on `/agents` | Needs `CommissionLedger` and `Payout` tables | Agent phase |
| Live updates (Socket.IO), notification bell | No real booking events exist until agents sell | Agent phase |
| Global search, calendar in top bar | Not needed for the demo flow | Later |
| Forgot-password flow | Owner resets staff passwords; needs email sending | Later |
| Real redBus/AbhiBus connectors, 2FA, deploy to AWS | Out of this phase | Later phases |

## 10. Open decisions

| Decision | Who | Blocks |
|---|---|---|
| Does a cancelled or refunded booking count as revenue? Gross fare or net of OTA commission? | Business owner | H5, H6 |
| Admin bookings view-only in this phase (recommended) or owner can create? | Tejomaya | H4 |
| Email unique across the whole system (as drafted) or per operator? | Team | T4 |
| Bus type list (AC Sleeper, Non-AC Sleeper, AC Seater, Non-AC Seater, AC Semi-Sleeper) correct? | Business owner | K3 |
| Repeating trip schedules in this phase or later? | Tejomaya | K5 |

## 11. Risks

- **Foundation is the critical path.** T1 to T3 block both others; do them before anything else.
- **Schema churn.** Changing a table after people built on it costs everyone. Review the schema properly at A0.
- **Seat layout screen is a rewrite, not a wiring job.** K2 may take longer than it looks.
- **Bookings and dashboard depend on seed data** until the Agent phase, so the seed must be realistic.
