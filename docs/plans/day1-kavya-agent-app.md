# Day 1 task sheet — Kavya — Agent app

Paste this whole file into your AI coding tool as the first message. Work through the tasks in order. Stop and message Tejomaya if anything in the "API contract" section looks wrong — do not change it on your own, because the backend is being built to the same contract today.

---

## Context for the AI tool

You are working in the repository `kenroute-booking-suite-agent` (https://github.com/kenroute999/kenroute-booking-suite-agent). It is the **Agent web app** of KenRoute, a system for bus operators. A ticket agent uses this app to search trips, pick seats, book tickets and track commission.

- Stack: TanStack Start (React 19), TanStack Router with file-based routes in `src/routes/`, TanStack Query v5 (installed, currently unused), Tailwind CSS v4, shadcn/ui in `src/components/ui/`, react-hook-form + zod, sonner for toasts, Bun as package manager.
- Run it: `bun install`, then `bun run dev`. It serves on http://127.0.0.1:3002.
- Today every screen reads hardcoded arrays and there is no login. A real backend is being built in parallel and will be reachable at `http://127.0.0.1:5000/api/v1`. It is **not ready yet**, so today's work runs against a mock layer that returns data in exactly the contract shapes below. Tomorrow we flip one environment variable and the same code talks to the real server.

Rules:
1. Work only inside this repository. Match the existing code style, naming and Tailwind classes. Reuse existing components before writing new ones.
2. Do not add new npm packages. Everything needed is already installed.
3. All server data goes through TanStack Query and the API layer from Task 2. No component may call `fetch` directly.
4. Never store tokens in `localStorage` or `sessionStorage`.
5. Money arrives as strings like `"1250.00"`. Convert with `Number()` only for display and arithmetic; format with `toLocaleString("en-IN")`.
6. Dates arrive as ISO 8601 UTC strings. Display them in the `Asia/Kolkata` timezone.
7. Create a branch `feature/day1-auth-booking` from `main`. Commit after each task with a clear message. Do not push to `main`.

---

## API contract (fixed for today)

Base URL comes from `import.meta.env.VITE_API_URL` (value: `http://127.0.0.1:5000/api/v1`).
Every request sends `credentials: "include"`. Every request except login and refresh sends `Authorization: Bearer <accessToken>`.

Every error response has this shape, with a matching HTTP status:

```json
{ "error": { "code": "SEAT_UNAVAILABLE", "message": "Seat L3 is no longer available", "details": {} } }
```

Error codes used today: `INVALID_CREDENTIALS` (401), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `VALIDATION_FAILED` (400), `RATE_LIMITED` (429), `NOT_FOUND` (404), `SEAT_UNAVAILABLE` (409), `HOLD_EXPIRED` (409).

### Auth

`POST /auth/login` — body `{ "email": string, "password": string }`

```json
{
  "accessToken": "eyJ...",
  "user": {
    "id": "uuid", "name": "Anil Kumar", "email": "anil@srikrishna.test",
    "role": "AGENT", "agentCode": "AGT1024", "commissionPct": "10.00",
    "operatorId": "uuid", "operatorName": "Sri Krishna Travels",
    "mustChangePassword": false
  }
}
```

The server also sets an HTTP-only refresh cookie. The browser handles it; the app never reads it.

`POST /auth/refresh` — no body. Returns the same shape as login. 401 `UNAUTHENTICATED` if the cookie is missing or expired.

`POST /auth/logout` — no body. Returns 204.

`GET /me` — returns the `user` object.

Only users with `role: "AGENT"` may use this app. If login succeeds with another role, show "This account cannot use the Agent app", call logout, and stay on the sign-in page.

### Trips and seats

`GET /routes/cities` → `{ "cities": ["Hyderabad", "Bengaluru", "Vijayawada"] }`

`GET /trips/search?from=Hyderabad&to=Bengaluru&date=2026-10-08`

```json
{
  "items": [
    {
      "id": "uuid", "origin": "Hyderabad", "destination": "Bengaluru",
      "departureAt": "2026-10-08T14:30:00.000Z", "arrivalAt": "2026-10-09T00:45:00.000Z",
      "fare": "1250.00", "busName": "KenRoute Volvo", "busType": "AC_SLEEPER",
      "registrationNo": "TS 09 AB 1234", "availableSeats": 21, "totalSeats": 36,
      "boardingPoints": ["Ameerpet", "Kukatpally"], "droppingPoints": ["Majestic", "Silk Board"]
    }
  ]
}
```

`GET /trips/:id/seats`

```json
{
  "trip": { "…same fields as a search item…" },
  "seats": [
    { "id": "uuid", "seatNumber": "L1", "deck": "LOWER", "row": 0, "col": 0,
      "seatType": "SLEEPER", "status": "AVAILABLE", "heldByMe": false, "passengerGender": null }
  ]
}
```

`status` is one of `AVAILABLE`, `HELD`, `BOOKED`, `BLOCKED`. `passengerGender` is `"MALE"`, `"FEMALE"` or `null` and is only set for booked seats (used for the pink "female" seat colour). `row` and `col` are zero-based grid positions within the deck; gaps in `col` are the aisle.

### Booking

`POST /bookings/hold` — body `{ "tripId": "uuid", "seatIds": ["uuid"] }` → `{ "heldUntil": "2026-10-06T10:05:00.000Z", "seatIds": ["uuid"] }`. Fails with 409 `SEAT_UNAVAILABLE` and `details: { "seatIds": ["uuid"] }` listing the seats that could not be held.

`POST /bookings`

```json
{
  "tripId": "uuid",
  "source": "AGENT",
  "boardingPoint": "Ameerpet",
  "droppingPoint": "Majestic",
  "paymentMode": "CASH",
  "notes": "",
  "passengers": [
    { "seatId": "uuid", "name": "Ramesh Kumar", "age": 34, "gender": "MALE",
      "phone": "9876543210", "idProofType": "AADHAAR", "idProofNumber": "123412341234" }
  ]
}
```

`source` is one of `AGENT`, `COUNTER`, `PHONE`, `CORPORATE`. `paymentMode` is `CASH` or `UPI` (online payment is paused until the payment gateway is set up). `idProofType` and `idProofNumber` are optional.

Response 201:

```json
{
  "pnr": "KR7H2M9Q",
  "totalFare": "1250.00",
  "commission": "125.00",
  "trip": { "…same fields as a search item…" },
  "bookings": [
    { "id": "uuid", "seatNumber": "L1", "fare": "1250.00", "passengerName": "Ramesh Kumar", "status": "CONFIRMED" }
  ]
}
```

Fails with 409 `HOLD_EXPIRED` or `SEAT_UNAVAILABLE`, or 400 `VALIDATION_FAILED` with `details` keyed by field path.

Test accounts (the mock layer must accept exactly these; the real seed will use the same):

| Email | Password | Role |
|---|---|---|
| `anil@srikrishna.test` | `Agent@123` | AGENT |
| `owner@srikrishna.test` | `Owner@123` | OWNER (must be refused by this app) |

---

## Task 1 — Setup (15 min)

1. Clone the repository, `bun install`, `bun run dev`, open http://127.0.0.1:3002 and click through all 10 pages so you know them.
2. Create branch `feature/day1-auth-booking`.
3. Create `.env.example` and `.env` with:
   ```
   VITE_API_URL=http://127.0.0.1:5000/api/v1
   VITE_USE_MOCKS=true
   ```
   Make sure `.env` is in `.gitignore`.

**Check:** the app still starts and looks unchanged.

## Task 2 — API layer and mock layer (1.5 h)

Create these files:

- `src/lib/api/client.ts` — one `api<T>(path, options)` function built on `fetch`. It prefixes `VITE_API_URL`, sets JSON headers, sends `credentials: "include"`, adds the bearer token from the auth store, and parses the response. On a non-2xx response it throws an `ApiError` class carrying `status`, `code`, `message`, `details`. On a 401 with code `UNAUTHENTICATED` it calls `/auth/refresh` once, retries the original request once, and if that also fails clears the auth store and redirects to `/login`. Concurrent 401s must share a single refresh call.
- `src/lib/api/types.ts` — TypeScript types for every request and response in the contract above.
- `src/lib/api/auth.ts`, `src/lib/api/trips.ts`, `src/lib/api/bookings.ts` — one small typed function per endpoint.
- `src/lib/api/mocks.ts` — when `VITE_USE_MOCKS === "true"`, `api()` routes the call to an in-memory mock instead of the network. The mock must: accept only the two test accounts; keep "logged in" state in a module variable so refresh works until the page reloads; return 3 cities and at least 4 trips for any search; return a 36-seat sleeper layout (18 lower, 18 upper, 3 columns with an aisle gap) with a mix of all four statuses; make hold fail with `SEAT_UNAVAILABLE` for seats that are not `AVAILABLE`; make booking succeed and return a random PNR; wait 300 ms before answering so loading states are visible.
- `src/lib/auth-store.ts` — holds `accessToken` and `user` in memory only (use the same `useSyncExternalStore` pattern the project already favours; no new library). Exposes `useAuth()`, `setSession()`, `clearSession()`.
- `src/lib/query-keys.ts` — one object with all query keys, for example `qk.trips.search(params)`, `qk.trips.seats(id)`, `qk.me`.

Delete `src/lib/api/example.functions.ts` (unused scaffold).

**Check:** `bunx tsc --noEmit` passes. In the browser console, importing and calling the login function with the agent test account returns a user.

## Task 3 — Toasts and error mapping (20 min)

1. Mount the existing sonner `<Toaster />` once in `src/routes/__root.tsx`.
2. Add `src/lib/error-message.ts`: a function that turns an `ApiError` code into a friendly sentence (for example `SEAT_UNAVAILABLE` → "That seat was just taken. Please pick another."), with a generic fallback.

**Check:** calling `toast.success("test")` from any page shows a toast.

## Task 4 — Sign-in, guard, logout, real identity (2 h)

1. New route `src/routes/login.tsx`: a centred card in the app's navy/green style with the KenRoute name, email and password fields (react-hook-form + zod: valid email, password required), a submit button with a loading state, and the error message under the form. It renders **without** `AgentShell`. On success store the session and navigate to `/`. Refuse non-agent roles as described in the contract.
2. Route guard. This app is server-rendered and the token lives only in browser memory, so the check must run in the browser, not on the server:
   - On first load in the browser, if there is no session, call `/auth/refresh` once. While that is in flight render a full-page loading state, not the page.
   - If refresh fails, navigate to `/login`. If it succeeds, render the page.
   - A signed-in user who opens `/login` is sent to `/`.
   Put this in one place (a wrapper used by `__root.tsx` or a pathless layout route) so every current and future page is covered. Do not copy it into each route.
3. Logout: the sidebar Logout button in `src/components/AgentShell.tsx` calls `/auth/logout`, clears the session, clears the TanStack Query cache and navigates to `/login`.
4. Real identity: replace the hardcoded "Anil Agent" / "AGT1024" with the signed-in user's `name` and `agentCode` in `AgentShell.tsx` and wherever else it is repeated — search the whole `src/` folder for `AGT1024` and `Anil Agent`. The avatar letter is the first letter of the name.
5. The user chip in the header currently looks like a menu but opens nothing. Make it a real dropdown using the existing shadcn `DropdownMenu`, with "Settings" (link to `/settings`) and "Log out".

**Check — do every one of these by hand:**
- Open http://127.0.0.1:3002 in a private window → you land on `/login`, never see the dashboard flash.
- Wrong password → clear error message, no crash, the form is usable again.
- Empty email or bad email format → field error, no request sent.
- Sign in as the agent → dashboard, header shows the name and agent code from the response.
- Sign in as the owner account → refused with the message, still on `/login`.
- While signed in, open `/login` → redirected to `/`.
- Click Logout → `/login`; pressing the browser Back button does not show any app page.
- Search `src/` for `AGT1024` → only the mock file contains it.

## Task 5 — Navigation fixes (45 min)

1. Below 1024px width the sidebar disappears and there is no navigation. Add a hamburger button in the header that opens the same nav links in the existing shadcn `Sheet`. It closes when a link is clicked.
2. On wide screens make the sidebar stay in view while the page scrolls (`sticky top-0 h-screen` with its own scroll), so Logout is always reachable.
3. Page titles: 8 of 10 pages show "Lovable App" in the browser tab. In `__root.tsx` change the default title to "KenRoute Agent" and remove the Lovable description, author and twitter meta. Give every route a `head` title like "New Booking · KenRoute Agent".
4. Remove the `to={to as "/"}` type escapes in `AgentShell.tsx` and `index.tsx` by typing the nav list properly.

**Check:** shrink the window to phone width → hamburger appears, every page reachable. Each tab shows its own title. `bunx tsc --noEmit` passes.

## Task 6 — New Booking flow on the API layer (rest of the day)

Rework `src/routes/new-booking.tsx` and `src/components/booking/BusSeatMap.tsx`. Keep the current visual design; replace the fake data and dead controls. Split the 624-line route into smaller components under `src/components/booking/` where it helps.

**Step A — trip search.** The page opens with a search bar: From and To (selects filled from `/routes/cities`), Date (the existing shadcn date picker; default today; past dates disabled), Search button. From and To cannot be equal. Results list each trip with times, bus, fare and available seats; a trip with 0 available seats is shown but cannot be selected. Include loading, empty ("No buses on this date") and error states. Remove the hardcoded Hyderabad → Bangalore / 20 May 2025 header.

**Step B — seat map from data.** Selecting a trip loads `/trips/:id/seats`. `BusSeatMap` must draw from each seat's `deck`, `row`, `col` (CSS grid; a missing `col` value is the aisle) instead of the fixed 4 × 6 slice, so any layout renders. Colours follow `status` and `passengerGender`. Only `AVAILABLE` seats (or `HELD` with `heldByMe`) can be selected. Nothing is preselected and no passenger is prefilled. Tooltips must not show other passengers' names or phone numbers. Refetch seats every 20 seconds while this step is open. The "Refresh" button refetches immediately.

**Step C — hold.** A "Continue" button sends the selected seats to `/bookings/hold`. On success show a visible countdown to `heldUntil` and move to the passenger step. On `SEAT_UNAVAILABLE` show the existing `SeatConflictBanner` (currently unreachable code) naming the lost seats, deselect them and refetch the seat map. When the countdown reaches zero, return to the seat map with a message.

**Step D — passenger form.** One form block per held seat, labelled with its seat number, using react-hook-form with a zod schema:
- name: required, 2 to 60 characters, letters, spaces and dots only
- age: whole number 1 to 120
- gender: required
- phone: exactly 10 digits, first digit 6 to 9
- ID proof type and number: optional, but if one is filled the other is required

Plus one set of booking fields: boarding point and dropping point (required; options come from the trip), booking source (the existing selector), payment mode (Cash, UPI; show "Online payment — coming soon" as a disabled option; remove the "Wallet" mode), notes (optional, max 200). "Add Another Passenger" goes back to the seat map to pick one more seat.

**Step E — summary and confirm.** The summary shows seats, fare per seat, **Total to collect from passenger** (seats × fare) and, separately, **Your commission** (total × the user's `commissionPct`). Remove the misleading "Net Amount" line and the duplicated counts and duplicated legend. "Generate Ticket" is disabled until the form is valid, shows a loading state, and posts `/bookings`. On `HOLD_EXPIRED` or `SEAT_UNAVAILABLE` show the mapped message and return to the seat map.

**Step F — ticket.** On success show a ticket view: PNR in large text, route, date and times, bus, boarding and dropping points, each passenger with seat number, total fare. Buttons: Print (opens the browser print dialog with a print stylesheet that shows only the ticket), "New Booking" (resets the flow). After success, invalidate the trips and bookings query keys.

Today's finish line is Step D working against mocks. Steps E and F are tomorrow morning if they do not fit.

**Check — do every one of these by hand:**
- Same city in From and To → blocked with a message.
- Search → loading state, then trips; a date with the mock returning nothing → empty state.
- Seat map shows two decks and an aisle; booked and blocked seats cannot be clicked.
- Select 2 seats → Continue → countdown visible, 2 passenger blocks appear with the right seat numbers.
- Force a hold failure in the mock → conflict banner appears, seat is deselected.
- Submit with everything empty → every required field shows its own error, no request is sent.
- Age `abc`, age `0`, phone `12345`, phone `1234567890` → each rejected with a clear message.
- Fill ID type without number → rejected.
- (If E and F are done) Confirm → ticket with a PNR; Print shows only the ticket; total and commission are correct for 2 seats.
- Reload the page in the middle of the flow → you stay signed in and land back at the search step without errors.
- `bunx tsc --noEmit` and `bun run lint` both pass.

---

## End of day — send this to Tejomaya

1. Branch pushed and a pull request opened against `main`, titled "Day 1: auth, shell, booking flow".
2. One line per task: done / partly (what is left) / not started.
3. Any place where the contract did not fit what the screen needs — exact field and why. This matters most: it is cheap to change the contract tonight and expensive tomorrow.
4. A short screen recording or screenshots of sign-in and the booking flow.

## Not today

Booking history, tickets, wallet, passengers, reports, offers, support, settings, and the dashboard stay untouched until Day 2 and Day 3. Do not start them early; the contract for those screens is not fixed yet.
