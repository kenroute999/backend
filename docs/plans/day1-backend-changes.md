# Backend change note — from the answered questions (6 Oct)

Paste into the running backend session. These decisions arrived after `docs/plans/day1-tejomaya-backend.md` was written and override it where they differ. Apply them as a **new migration** on top of the existing one (do not edit the applied `init` migration), update the code, seed and tests already written, then continue with the remaining tasks. Finish the task you are in the middle of first if stopping would leave things broken.

## 1. Bus types — DONE, do not redo

Already migrated (`staff_fields_and_bus_seating`): `Bus.type` is replaced by `isAc Boolean` and `seating` (enum `SLEEPER`, `SEATER`, `SEATER_SLEEPER`), matching the Admin "Add Bus" form (Sleeper 2+1, Seater 2+2, Seater/Sleeper 2+1, each AC or Non-AC). There is no semi-sleeper type. In API responses return one `busType` string built from the two fields: `AC_SLEEPER`, `NON_AC_SLEEPER`, `AC_SEATER`, `NON_AC_SEATER`, `AC_SEATER_SLEEPER`, `NON_AC_SEATER_SLEEPER`. Seat `type` inside a layout is `SLEEPER` or `SEATER`.

Also already built and tested: server skeleton (`src/app.ts`, `src/core/*`), the agents and drivers APIs (`src/modules/agents`, `src/modules/drivers`), `prisma/seed.ts`, and a temporary `devTenant` stub in `src/core/dev-tenant.ts` that must be replaced by real authentication (Task 3 and 4). 

**Staff tables are separate (decided 6 Oct, migration `separate_staff_tables`).** `User` holds owner accounts only. `Agent`, `Conductor` and `Driver` are their own tables; agents and conductors carry their own email and password hash, drivers have no login. Consequences for the remaining tasks:
- Login looks the email up in `User`, then `Agent`, then `Conductor`; the token's `role` comes from which table matched. Emails are kept unique across the three by `assertEmailFree` in `src/core/accounts.ts` — use it wherever a login account is created or its email changes.
- `RefreshToken` identifies its account by `accountType` + `accountId`; `AuditLog` by `actorType` + `actorId`; `SupportMessage` by `authorType` + `authorId`; `Notification` by `recipientType` + `recipientId`. These have no foreign key, so delete an account's refresh tokens when the account is deleted.
- `Booking.agentId`, `CommissionLedger.agentId`, `Payout.agentId`, `SupportTicket.agentId`, `TripSeat.heldById` point to `Agent`; `Trip.conductorId` and `Passenger.boardedById` to `Conductor`; `Trip.driverId` to `Driver`.
- Endpoints are `/agents`, `/drivers` (built) and `/conductors` (to build, same shape as agents without commission). There is no `/users` staff endpoint.

## 2. Fare is per seat, and the owner can change it per trip

Fares differ by seat type and by day or festival.

- Each seat object in `SeatLayout.seats` carries `type` (`SLEEPER`, `SEATER`) and `ladiesOnly` (boolean) in addition to number, deck, row, col. Validate both.
- `TripSeat` gains `fare Decimal(10,2)` and `ladiesOnly Boolean`.
- `POST /trips` accepts `baseFare` (defaults to the route's base fare) and optional `fareRules: [{ deck?, seatType?, fare }]`. Each generated seat takes the fare of the most specific matching rule, otherwise `baseFare`.
- `PATCH /trips/:id` accepts the same `baseFare` / `fareRules` and re-prices seats that are not booked (this is how festival or weekend pricing is applied). Booked seats keep the fare they were sold at.
- `Trip.fare` stays as the base fare. In `GET /trips/search` the `fare` field is the lowest fare among that trip's available seats.
- `GET /trips/:id/seats`: every seat also returns `fare` (decimal string) and `ladiesOnly`.

## 3. Booking rules

- A booking's fare comes from its seat's `TripSeat.fare`, never from the request.
- A `ladiesOnly` seat can only be booked for a passenger with gender `FEMALE`; otherwise `VALIDATION_FAILED` with the passenger's field path in `details`.
- `idProofType` and `idProofNumber` are now **required** for every passenger. Types: `AADHAAR`, `PAN`, `DRIVING_LICENCE`, `VOTER_ID`, `PASSPORT`.
- Agents see and cancel only their own bookings. A booking cannot be changed to another seat or date: cancel and book again.
- There is one pool of seats per trip shared by every channel. Whoever commits first gets the seat; the row lock plus the partial unique index is the guarantee. No per-channel seat quotas.

## 4. Statuses

- Add `NO_SHOW` to `BookingStatus`. When a trip ends, confirmed bookings that were not boarded become `NO_SHOW`. No refund; they still count as revenue.
- When the owner cancels a trip, its active bookings become `CANCELLED` with `cancelReason = "TRIP_CANCELLED"` (add `Booking.cancelReason String?`). Refunds are paid by the owner outside the system; the owner then marks each one `REFUNDED` with `refundAmount`. Provide a filter on the bookings list for "refund pending" (cancelled by trip cancellation, not yet refunded).

## 5. Offers

Only the owner creates, edits and deactivates offers. Agents can list active offers and validate a code at booking time. Nothing else.

## 6. Conductor (Day 2, noted now so the schema is right)

The manifest returns seat number, passenger name, PNR and boarded state only — no fares, no phone numbers, not even masked. Conductors are assigned per trip, cannot sell seats, and scan a QR code that contains the PNR only. Drivers are records managed in Admin and never log in.

## 7. Seed: three dummy operators

There is no real operator yet. Seed three, each fully usable, so isolation is visible in every app:

| Operator | Owner login | Agent login | Conductor login |
|---|---|---|---|
| Sri Krishna Travels | `owner@srikrishna.test` | `anil@srikrishna.test` (AGT1024, 10%) + one more | `conductor@srikrishna.test` |
| Orange Line Travels | `owner@orangeline.test` | `agent@orangeline.test` | `conductor@orangeline.test` |
| Deccan Express | `owner@deccan.test` | `agent@deccan.test` | `conductor@deccan.test` |

Passwords stay `Owner@123`, `Agent@123`, `Conductor@123`. Between them the fleets must cover AC and non-AC and all three seating arrangements, every layout must include some `ladiesOnly` seats, and sleeper layouts must price upper and lower decks differently. This replaces the earlier "Test Travels" second operator.

## 8. Still open — keep the defaults

Commission rule (one percentage per agent on the full fare), settlement cycle, agent credit limit, seat-hold time (5 minutes), cancellation cut-off and charge (until departure, no charge), revenue definition. These are waiting on the CEO; build the defaults so that each is one function or one constant to change.

## Report

Add to the final report: the new migration's name, and confirmation that tests cover per-seat fares, the ladies-only rule and required ID proof.
