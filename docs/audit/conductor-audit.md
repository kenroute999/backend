# Conductor app — frontend audit

App folder: `counductor/` · Dev URL: http://127.0.0.1:3003 · Audited 2026-10-05 by reading code (not browser-tested; items marked "unverified" need a visual check).

This web app is the functional reference for the React Native rewrite, so behaviour gaps here matter for the mobile app too.

**Totals: 9 BIG / 15 MED / 52 SMALL**

- **BIG** = feature missing or broken
- **MED** = control does nothing
- **SMALL** = cosmetic, label, leftover

Tick a box when fixed. All paths are relative to `counductor/`.

---

## Global / shell

- [ ] **BIG** `src/routeTree.gen.ts:22-52` — only 7 routes exist; no sign-in route and no auth guard.
- [ ] **BIG** `src/router.tsx:6`, `src/routes/__root.tsx:119` — no API layer at all; QueryClient provided but never used.
- [ ] **BIG** `src/lib/trip-store.ts:27` — state is an in-memory module variable; reload resets to the 12 seed passengers.
- [ ] **BIG** whole app — no offline indicator, no network-status handling, no queued writes.
- [ ] **MED** `src/routes/__root.tsx:75-99` — no loading states anywhere and no per-route error state.
- [ ] **MED** `src/lib/trip-store.ts:68-69` — `available = capacity − boarded` instead of capacity − booked: shows 41 available when 12 of 48 are booked (should be 36). Shown on `/` (`index.tsx:119`) and `/trip-summary` (`trip-summary.tsx:63`).
- [ ] **MED** `src/lib/trip-store.ts:3-10` — `Passenger` has no boarding point, drop point, PNR, booking source or boarded-at time.
- [ ] **MED** `src/components/PageHeader.tsx:22` — back uses browser history with no fallback; after refresh on a sub-page there is nowhere to go back to.
- [ ] **SMALL** `src/lib/trip-store.ts:70` — occupancy is boarded/48, not booked/48.
- [ ] **SMALL** `src/lib/trip-store.ts:68` — capacity `48` hardcoded.
- [ ] **SMALL** `src/lib/trip-store.ts:27,60` — module-level singleton also lives on the SSR server; would be shared across users once populated server-side.
- [ ] **SMALL** `src/lib/trip-store.ts:47-48` — `boardByCode` re-renders even when passenger already boarded.
- [ ] **SMALL** `src/lib/trip-store.ts:82` — trip date is the literal string "Today".
- [ ] **SMALL** `src/lib/trip-store.ts:13,87` — conductor "Ramesh Kumar" has the same name as passenger 1.
- [ ] **SMALL** `src/routes/__root.tsx:115-123` — no toast host mounted; boarding toggles give no confirmation.
- [ ] **SMALL** `src/components/BottomNav.tsx:7`, `src/routes/__root.tsx:79` — fixed bottom nav has no safe-area padding.
- [ ] **SMALL** `src/components/BottomNav.tsx:14` — fake iOS home-indicator pill drawn inside the nav.
- [ ] **SMALL** `src/components/BottomNav.tsx:9-12,23` — `/boarding`, `/trip-summary`, `/profile` have no nav item, so no tab is highlighted on them.
- [ ] **SMALL** `src/components/PageHeader.tsx:20` — back button shown on main tabs `/passengers` and `/scan`.
- [ ] **SMALL** `src/components/PageHeader.tsx:35-43` — profile icon renders on `/profile` itself (links to itself).
- [ ] **SMALL** `src/routes/__root.tsx:15-35` — 404 page renders outside the mobile shell.
- [ ] **SMALL** Lovable scaffold leftovers: `src/routes/__root.tsx:13,41`, `src/lib/lovable-error-reporting.ts`, `vite.config.ts:7`, package name `tanstack_start_ts`.
- [ ] **SMALL** `src/components/ui/*` (46 files), `src/hooks/use-mobile.tsx` — none imported by any route; their dependencies are unused.
- [ ] **SMALL** `src/styles.css:5` — dark variant declared, no dark tokens.
- [ ] **SMALL** `public/` — only favicon; no manifest, theme-color or service worker.
- [ ] **SMALL** `package.json:7` — dev server bound to 127.0.0.1, so it cannot be opened from a phone on the same Wi-Fi.
- [ ] **SMALL** stray items in app root: empty `agent/` folder, `conductor-dev.log`, `conductor-err.log`, `conductor-out.log`.
- [ ] **SMALL** all routes — every string is hardcoded English; no translation support.

## `/` Home — `src/routes/index.tsx` (181 lines)

- [ ] **BIG** `index.tsx:59-100` — one hardcoded trip always shown; no Start Trip, no trip selection, no "no trip assigned" state.
- [ ] **MED** `index.tsx:65-67` — "ON TRIP" badge is static text.
- [ ] **SMALL** `index.tsx:52,54` — greeting name and conductor ID hardcoded.
- [ ] **SMALL** `index.tsx:73-86` — route and bus hardcoded; departure, arrival and date not shown.
- [ ] **SMALL** `index.tsx:91` — "Total" (12 booked) is ambiguous next to seat capacity.
- [ ] **SMALL** `index.tsx:20-22` — no page title.
- [ ] **SMALL** `index.tsx:158-167`, `BottomNav.tsx:19` — `to` typed as `string`, losing typed-route checking (unverified whether it passes typecheck).

## `/scan` — `src/routes/scan.tsx` (152 lines)

- [ ] **BIG** `scan.tsx:48-62` — QR scanner is fake: a styled box with an animation; no camera, no decoder.
- [ ] **BIG** `scan.tsx:30-32`, `trip-store.ts:42-50` — scanning an already-boarded ticket shows the same green "Boarded"; duplicate or reused tickets not detected.
- [ ] **MED** `scan.tsx:29` — empty submit returns silently with no message.
- [ ] **MED** `scan.tsx:121-145` — "Quick board pending" boards on one tap with no ticket check or confirmation; shows only first 3 pending.
- [ ] **SMALL** `scan.tsx:93-117` — result banner has no undo, persists until next submit, not cleared on typing.
- [ ] **SMALL** `scan.tsx:66-83` — label not bound to input; no autofocus or max length.
- [ ] **SMALL** `trip-store.ts:44` — exact match only: "TKT 004" or "4" gives "No ticket found".

## `/passengers` — `src/routes/passengers.tsx` (161 lines)

- [ ] **SMALL** `passengers.tsx:28-31` — search not trimmed; phone not searchable.
- [ ] **SMALL** `passengers.tsx:108` — "Undo" un-boards immediately with no confirmation.
- [ ] **SMALL** `passengers.tsx:26-27,108` — with Pending filter active, "Mark Boarded" makes the row vanish; Undo only reachable after switching filter.
- [ ] **SMALL** `passengers.tsx:77-78` — expandable rows have no expand indicator; several can be open at once.
- [ ] **SMALL** `passengers.tsx:78` — default marker may still show in Safari (unverified).
- [ ] **SMALL** `passengers.tsx:102` — phone link has no country code.
- [ ] **SMALL** `passengers.tsx:70` — search input is 14px, which triggers zoom on iPhone.
- [ ] **SMALL** `passengers.tsx:41-47` — "Total" chip doubles as the "All" filter.
- [ ] **SMALL** `passengers.tsx:121-125` — one "No passengers match." message covers both no-results and an empty trip.

## `/boarding` — `src/routes/boarding.tsx` (82 lines)

- [ ] **BIG** `boarding.tsx:47-75` — no bulk boarding: no select-all or board-all; same per-row toggle as `/passengers`.
- [ ] **MED** `boarding.tsx:51` — one tap on a boarded row un-boards it with no confirmation, while subtitle says "Tap to mark boarded".
- [ ] **SMALL** `boarding.tsx:47-48` — no search, filter or sort; pending not grouped first.
- [ ] **SMALL** `boarding.tsx:50` — toggle button has no pressed state for screen readers.
- [ ] **SMALL** `index.tsx:109` — this screen is reachable only from the dashboard quick action.

## `/trip-summary` — `src/routes/trip-summary.tsx` (106 lines)

- [ ] **BIG** `trip-summary.tsx:75-77` — "End Trip" has no onClick; no trip state, so boarding stays possible forever.
- [ ] **MED** `trip-summary.tsx:31-33` — "ON TRIP" badge is static text.
- [ ] **SMALL** `trip-summary.tsx:23,46` — date shows literal "Today" twice.
- [ ] **SMALL** `trip-summary.tsx:47-48` — arrival 06:45 after departure 21:30 has no next-day marker.
- [ ] **SMALL** `trip-summary.tsx:52-73` — no list of pending/no-show passengers; no end-of-trip confirmation.

## `/profile` — `src/routes/profile.tsx` (83 lines)

- [ ] **MED** `profile.tsx:50-52` — "Log Out" has no onClick.
- [ ] **SMALL** `profile.tsx:40` — rating "4.8" hardcoded.
- [ ] **SMALL** `profile.tsx:33-35` — "Active Conductor" status hardcoded.
- [ ] **SMALL** `profile.tsx:39,44-47` — trips (428), phone, email, depot, joined date all hardcoded.
- [ ] **SMALL** `profile.tsx:44-45` — phone and email are plain text; no edit option.
- [ ] **SMALL** `profile.tsx:22` — header profile icon links back to this page.
- [ ] **SMALL** `profile.tsx:26-28` — avatar is first letter only.

## `/more` — `src/routes/more.tsx` (88 lines)

- [ ] **MED** `more.tsx:51` — "Notifications" row dead.
- [ ] **MED** `more.tsx:52` — "Settings" row dead.
- [ ] **MED** `more.tsx:53` — "Help & Support" row dead.
- [ ] **MED** `more.tsx:54` — "About KenRoute" row dead.
- [ ] **MED** `more.tsx:57-59` — "Log Out" has no onClick.
- [ ] **SMALL** `more.tsx:62` — version "v1.0.0" hardcoded.
- [ ] **SMALL** `more.tsx:34-46,49` — three separate links all go to `/profile`.

---

## Working today

Manual ticket entry boards the passenger (trimmed, case-insensitive); unknown code shows "No ticket found". Passenger filter chips and search (name, seat, ticket code), Mark Boarded and Undo. Boarding toggle and progress bar. Total/boarded/pending counts stay consistent across all screens. No fares, revenue or commission shown anywhere (correct for conductor role). Content clears the fixed bottom nav on every screen.

## Mock data to replace with API calls

| Location | Variable | Entity |
|---|---|---|
| `src/lib/trip-store.ts:12-25` | `initial` | the 12 passengers of the trip |
| `src/lib/trip-store.ts:27` | `passengers` | live in-memory boarding state |
| `src/lib/trip-store.ts:68` | `capacity` (48) | bus seat capacity |
| `src/lib/trip-store.ts:74-83` | `TRIP_INFO` | current trip |
| `src/lib/trip-store.ts:85-94` | `CONDUCTOR` | signed-in conductor |
| `src/routes/profile.tsx:40` | inline "4.8" | conductor rating |
| `src/routes/profile.tsx:34` | inline "Active Conductor" | account status |
| `src/routes/index.tsx:66`, `src/routes/trip-summary.tsx:32` | inline "ON TRIP" | trip status |
| `src/routes/more.tsx:62` | inline "v1.0.0" | app version |
| `src/routes/scan.tsx:81` | placeholder "e.g. TKT004" | ticket code format |
