# KenRoute — Multi-Tenant Database Schema Design (Task 2)

**Date:** 22 Jul 2026
**Status:** Approved design, ready for implementation planning
**Relates to:** `docs/superpowers/specs/2026-07-13-kenroute-backend-design.md` (original business/system spec), `docs/superpowers/plans/2026-07-20-kenroute-core-backend.md` (Task 2 in the original 13-task Phase 1 plan)
**Purpose:** Resolve the open Booking/Passenger modeling questions and the Trip-conductor gap from the original Task 2 plan, confirm entity scope, and define the authorization matrix — so `schema.prisma` can be written as a direct translation of an agreed design rather than guessed at.

---

## 1. Entity Scope

**In scope now (core booking flow):**

Operator, User, Bus, BusRoute, Channel, Trip, Seat, Booking, Passenger, CommissionLedger — the same 10 entities as the original Task 2 plan, carried forward unchanged except for the two amendments in §3.

**Explicitly deferred to a later schema revision** (none block a working booking flow — they're operational/financial add-ons, not prerequisites for selling and boarding a seat):

| Entity | Why deferred |
|---|---|
| Driver | Nothing in the booking/selling/boarding flow reads driver data yet — informational for the Owner only |
| SeatLayout (as distinct from Seat) | Seat already models per-trip seat state; a reusable layout template is an optimization, not a requirement |
| Wallet / WalletTransaction | No payment/payout system exists yet to reconcile against |
| Offer | No promotions engine in Phase 1 |
| Support | No support-ticket workflow in Phase 1 |
| Settings | No per-operator configurable settings identified yet beyond what's already on `Operator.plan` |

Revisit this list once Phase 1 (Tasks 1-13) ships and real usage surfaces which of these are actually needed next.

---

## 2. Entity Definitions

Full field-level definitions for the 10 in-scope entities are already written in `docs/superpowers/plans/2026-07-20-kenroute-core-backend.md` (Task 2, "Step 2: Write `prisma/schema.prisma`"), including a full `schema.prisma` draft. That draft stands as-is except for the amendments below.

| Entity | Purpose |
|---|---|
| Operator | The bus company (tenant root). Everything else belongs to one Operator. |
| User | Every human who logs in — Owner, Agent, or Conductor — in one table, distinguished by `role` enum. Not split into per-role tables. |
| Bus | A physical vehicle: registration number, type, total seats. |
| BusRoute | An origin → destination pair, reused across many trips. |
| Channel | Where a booking can come from: `OWN_AGENT`, `REDBUS`, `ABHIBUS`. |
| Trip | One bus + one route + one departure time. The unit that gets scheduled. |
| Seat | A single seat on a specific Trip, with its own availability status. |
| Booking | One sold seat: links Trip, Seat, Channel, optional Agent, fare, PNR, status. |
| Passenger | The rider's details for one Booking (1:1). |
| CommissionLedger | What an Agent earns for one Booking (1:1, only exists when a commission applies). |

---

## 3. Amendments to the Original Task 2 Schema

Two changes, both resolving open questions from the original plan.

### 3.1 `Trip` — conductor assignment

The Conductor app needs to filter to "my assigned trips." Adds:

```prisma
conductorId String?
conductor   User?   @relation("ConductorTrips", fields: [conductorId], references: [id])
```

One optional conductor per trip, set by the Owner at scheduling time.

### 3.2 `Booking` — per-seat bookings, shared PNR, refund tracking

Resolves all four open Booking/Passenger questions from the original plan:

| Question | Resolution |
|---|---|
| Multiple passengers per booking? | No. One Booking row = one Seat = one Passenger. A group purchase (e.g. a family of 4) becomes 4 Booking rows. |
| How are grouped seats tied together? | They share the same `pnr` value. `pnr` is **no longer unique per row** — it's a group label, not a row key. |
| Refunds? | New nullable `refundAmount Decimal? @db.Decimal(10, 2)` field; status flips to `REFUNDED`. No separate ledger table — there's no payment/wallet system yet to reconcile a ledger against. |
| OTA vs. direct bookings? | No new field. `Channel` already marks the source, `agentId` is already nullable (null for OTA-sourced bookings), and `CommissionLedger` only exists for bookings that actually earn agent commission. An `externalBookingRef` field can be added when Phase 3 builds the real OTA connector and its API shape is known. |
| Partial cancellations? | Free consequence of per-seat bookings — cancelling 1 of 4 seats just cancels that one Booking row; the other 3 are untouched. |

Schema delta:

```prisma
model Booking {
  // ...unchanged fields from the original plan...

  refundAmount Decimal? @db.Decimal(10, 2)

  @@index([operatorId, pnr])   // was: @@unique([operatorId, pnr])
}
```

`seatId` stays `@unique` on `Booking` — a seat can only ever be booked once, regardless of grouping.

---

## 4. Relationship Diagram

```text
Operator
  ├── User (role: OWNER | AGENT | CONDUCTOR)
  ├── Bus
  ├── BusRoute
  ├── Channel (OWN_AGENT | REDBUS | ABHIBUS)
  ├── Trip (bus + busRoute + conductor[optional] + departureAt)
  │     └── Seat (per trip, status: AVAILABLE | HELD | BOOKED)
  │           └── Booking (1:1 with Seat; channel + optional agent; pnr shared across a group)
  │                 ├── Passenger (1:1 with Booking)
  │                 └── CommissionLedger (1:1 with Booking, only when an agent earns commission)
```

---

## 5. Multi-Tenant Strategy

Every one of the 10 in-scope tables carries `operatorId`, enforced at the middleware layer (Task 4 of the original plan) so no query can cross an Operator boundary. This is a single rule applied uniformly — not one that varies per table, so no separate isolation matrix is needed.

---

## 6. Authorization Matrix (RBAC)

| Entity | OWNER | AGENT | CONDUCTOR |
|---|---|---|---|
| User | Full CRUD (within own Operator) | — | — |
| Bus | Full CRUD | Read | — |
| BusRoute | Full CRUD | Read | — |
| Channel | Full CRUD | Read | — |
| Trip | Full CRUD | Read | Read (only where `conductorId = self`) |
| Seat | Read | Read | Update status (only for trips where `conductorId = self`) |
| Booking | Read (all) | Create, Cancel (own bookings) | — |
| Passenger | Read (all) | Create/Update (own bookings) | Update `boarded` (only for trips where `conductorId = self`) |
| CommissionLedger | Read + update `status` (payout) | Read (own only) | — |

Nobody but OWNER touches `User`, `Channel`, or `CommissionLedger.status`. This matrix is the source of truth for Task 4's RBAC middleware — it doesn't need a separate document.

---

## 7. Database Constraints

Constraints are declared directly in `schema.prisma` (Prisma doesn't need a separate constraints document — the schema *is* the constraint declaration):

- Every table: `operatorId` + `@@index([operatorId])` (or a composite index where the table is frequently queried by operator + another field, e.g. `Trip.@@index([operatorId, departureAt])`, `Booking.@@index([operatorId, pnr])`)
- `User.@@unique([operatorId, email])` — email unique per operator, not globally
- `Bus.@@unique([operatorId, registrationNo])`
- `Channel.@@unique([operatorId, type])` — one row per channel type per operator
- `Seat.@@unique([tripId, seatNumber])`
- `Booking.seatId` — `@unique` (a seat can only be booked once)
- `Booking.pnr` — indexed, not unique (§3.2)

No soft deletes in Phase 1 — none of the 10 entities have a stated business need to "undelete" a record; cascade/restrict behavior follows Prisma defaults (restrict) unless a specific relation needs otherwise, decided at schema-writing time.

---

## 8. Migration Plan

Unchanged from the original Task 2 plan (`docs/superpowers/plans/2026-07-20-kenroute-core-backend.md`, Steps 1, 3, 7):

1. `kenroute_dev` and `kenroute_test` databases already provisioned, `.env` already configured (confirmed working as of this session).
2. `npx prisma migrate dev --name init` against `kenroute_dev`.
3. `npx prisma migrate deploy` against `kenroute_test` (via `DATABASE_URL` override).
4. `prisma/seed.ts` seeds one demo Operator, 3 Channels, 1 Owner login.

---

## 9. Open Items for Later

- Add `Driver`, `SeatLayout`, `Wallet`/`WalletTransaction`, `Offer`, `Support`, `Settings` in a follow-up schema revision once Phase 1 ships.
- Add `Booking.externalBookingRef` when Phase 3's OTA connector is built and its API response shape is known.
- Decide explicit cascade/restrict rules per relation when `schema.prisma` is actually written (deferred from §7 — a coding-time detail, not a design-time one).
