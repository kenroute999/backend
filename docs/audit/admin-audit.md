# Admin app — frontend audit

App folder: `admin/` · Dev URL: http://127.0.0.1:3001 · Audited 2026-10-05 by reading code (not browser-tested; items marked "unverified" need a visual check).

**Totals: 17 BIG / 46 MED / 70 SMALL**

- **BIG** = feature missing or broken
- **MED** = control does nothing
- **SMALL** = cosmetic, label, leftover

Tick a box when fixed. All paths are relative to `admin/`.

---

## Global / shell

- [ ] **BIG** `src/routeTree.gen.ts:25-70` — only 10 routes exist; no sign-in / forgot-password page.
- [ ] **BIG** `src/routes/__root.tsx:52-71`, `src/router.tsx:8` — no auth guard anywhere; every screen is public; no role/permission concept.
- [ ] **BIG** `src/components/layout/Sidebar.tsx:73` — Logout button has no onClick.
- [ ] **BIG** `src/components/layout/Sidebar.tsx:35`, `Topbar.tsx:6` — sidebar is hidden below 768px and the hamburger Menu button has no onClick; no navigation at all on small screens.
- [ ] **BIG** `src/routes/__root.tsx:85` — QueryClientProvider mounted but zero `useQuery`/`useMutation`/loaders; no real loading or fetch-error states; skeletons are fake 600 ms timers (`buses.tsx:150`, `bookings.tsx:173`, `routes.tsx:218`).
- [ ] **BIG** `src/components/layout/Sidebar.tsx:18-29` — missing screens: trips/schedules, conductors, passengers, payments/refunds, staff users/roles, notifications.
- [ ] **MED** `src/components/layout/Topbar.tsx:12-16` — global search input has no handler.
- [ ] **MED** `src/components/layout/Topbar.tsx:19-21` — Calendar button dead.
- [ ] **MED** `src/components/layout/Topbar.tsx:23-28` — Bell button dead; badge "5" hardcoded.
- [ ] **MED** `src/components/layout/Topbar.tsx:30-39` — user block looks like a menu (ChevronDown) but opens nothing; identity hardcoded "A / Admin / Super Admin" (wrong role label for an operator owner).
- [ ] **MED** `src/styles.css:7-42` — `--color-chart-*` and `--color-sidebar-*` are not in `@theme`, so classes like `text-chart-5`, `bg-chart-5/…`, `ring-chart-5`, `border-sidebar-border` emit no CSS. Affects `stat-card.tsx:17`, `index.tsx:281,386,498`, `integrations.tsx:110-112,143-144,238,403`, `reports.tsx:555,829,831`, `seat-layouts.tsx:194-218,521`, `Sidebar.tsx:35,36,72`. (unverified in browser)
- [ ] **MED** `src/routes/index.tsx:96-113,195` vs `integrations.tsx:88-115,376` — dashboard shows redBus/AbhiBus "Connected" with 482/356 bookings; integrations shows both "Ready to Connect", 0 bookings, "Coming Soon".
- [ ] **SMALL** bus counts contradict: `index.tsx:168` "Active Buses 156"; `buses.tsx:346-347` "Total 156 / Active 122"; `integrations.tsx:119` "28 of 28"; table has 5 rows.
- [ ] **SMALL** route counts contradict: `index.tsx:167` "85"; `routes.tsx:273-274` "156 / 142"; `integrations.tsx:118` "42"; table has 6 rows.
- [ ] **SMALL** today's totals contradict: `index.tsx:164-165` "1,248 bookings / ₹12,45,680"; `bookings.tsx:227,230` "1,254 / ₹8,45,230".
- [ ] **SMALL** entities do not match across screens: `agents.tsx:16-21` vs `reports.tsx:125-131` (different agent names); `reports.tsx:117-123` buses not in `buses.tsx`; bookings/routes/seat-layouts use buses absent from `buses.tsx:69-75`; TS 09 AB 1234 is "KenRoute Volvo" in buses, "Volvo B11R" in routes/bookings.
- [ ] **SMALL** `buses.tsx:72` TS 09 EF 9101 is "Maintenance" but `routes.tsx:119-130` has it on an Active route; `buses.tsx:74` TS 09 IJ 3344 "Inactive" but `bookings.tsx:100` has a Pending booking on it.
- [ ] **SMALL** OTA colours inconsistent: redBus `#e63946` (`index.tsx:81`, `bookings.tsx:125`) vs brand green (`reports.tsx:102`); AbhiBus `#f4a261` vs `#7c3aed` vs chart-5.
- [ ] **SMALL** status colours inconsistent: shared StatusPill (`status-pill.tsx:7-11`) vs separate local StatusBadge copies (`buses.tsx:77-90`, `routes.tsx:162-175`); Field/pagination markup duplicated per route.
- [ ] **SMALL** `src/components/ui/stat-card.tsx:31-32` — delta always green with up-arrow, including Cancelled, Maintenance, Inactive.
- [ ] **SMALL** `src/components/layout/PageHeader.tsx:15` — breadcrumb "Dashboard ›" is plain text, not a link.
- [ ] **SMALL** `src/components/layout/PageHeader.tsx:10` — no flex-wrap; wide action rows may get clipped (unverified).
- [ ] **SMALL** `src/styles.css:5,104` — dark theme classes exist; no toggle anywhere.
- [ ] **SMALL** `src/routes/__root.tsx:60-65`, `public/` — no favicon; `robots.txt` is `Allow: /` on a back office.
- [ ] **SMALL** `src/routes/__root.tsx:40` — error screen prints raw `error.message` to the user.
- [ ] **SMALL** Lovable scaffold leftovers: package name "tanstack_start_ts"; `src/lib/api/example.functions.ts`; `src/lib/config.server.ts`; `src/routes/README.md`; `.lovable/`; `@lovable.dev/vite-tanstack-config`; unused `src/hooks/use-mobile.tsx`.

## `/` Dashboard — `src/routes/index.tsx` (511 lines)

- [ ] **MED** `index.tsx:140-148,216-231` — Sync Inventory / Retry Failed only run a fake 2 s spinner; Last Sync never changes; both buttons spin together.
- [ ] **MED** `index.tsx:337,367` — both "View All" buttons dead.
- [ ] **SMALL** `index.tsx:157` — date "May 20, 2025" hardcoded in a box that looks like a date picker.
- [ ] **SMALL** `index.tsx:164-168` — all five KPI values and deltas hardcoded.
- [ ] **SMALL** `index.tsx:132-133` vs `164-165` — source totals carry no period and do not match "today" totals; redBus 482 vs 4,250.
- [ ] **SMALL** `index.tsx:395` — AlertDialog has `open` but no `onOpenChange`; Esc will not close it (unverified).
- [ ] **SMALL** `index.tsx:195-197` — "Connected" badge hardcoded; `connected` field unused.
- [ ] **SMALL** `index.tsx:322-330` — pulsing "Live" indicator over static values.
- [ ] **SMALL** `index.tsx:60-78,244,279` — chart points are fixed May 2025 dates labelled "this week".
- [ ] **SMALL** `index.tsx:34,81-85` — unused `Legend` import; unused `icon` field.

## `/buses` — `src/routes/buses.tsx` (479 lines)

- [ ] **MED** `buses.tsx:285-290` — Edit button dead.
- [ ] **MED** `buses.tsx:291-296` — Delete button dead.
- [ ] **MED** `buses.tsx:321-339` — pagination dead; page 1 always active.
- [ ] **MED** `buses.tsx:169-172,363-376` — Add Bus: no duplicate bus-number check, no number-format check, whitespace-only passes, no confirmation; row lives in memory only.
- [ ] **SMALL** `buses.tsx:316-318` — "Showing 1 to N of 25" hardcoded; prints "1 to 0" when empty.
- [ ] **SMALL** `buses.tsx:346-350` — stat cards hardcoded, unchanged after add.
- [ ] **SMALL** `buses.tsx:417-425` — Operator Name is free text per bus.
- [ ] **SMALL** `buses.tsx:407-416` — seat count is a free number, not linked to any seat layout.
- [ ] **SMALL** `buses.tsx:70-74,374` — per-row icon colour is arbitrary hardcoded data.

## `/routes` — `src/routes/routes.tsx` (681 lines)

- [ ] **BIG** `routes.tsx:498-520,523-612` — Add Route has no validation despite asterisks; saves a blank route.
- [ ] **BIG** `routes.tsx:60-73` — one row = route + one bus + one departure + one fare; no trips/schedule/running days, no per-seat-type fare.
- [ ] **MED** `routes.tsx:399-401` — "+N more" boarding-points button dead.
- [ ] **MED** `routes.tsx:415-432` — View / Edit / Delete buttons dead.
- [ ] **MED** `routes.tsx:457-475` — pagination dead.
- [ ] **MED** `routes.tsx:560-586` — Dropping Points, Distance, Duration are collected then discarded.
- [ ] **MED** `routes.tsx:508-510` — new route always gets busName "Assigned Bus" and busType "Sleeper".
- [ ] **MED** `routes.tsx:524-545` — city options come only from existing rows, so a new city cannot be added; same source and destination allowed.
- [ ] **MED** `routes.tsx:595` — Assign Bus options come from this file's own rows, not the bus list.
- [ ] **SMALL** `routes.tsx:454` — "of 156 routes" hardcoded.
- [ ] **SMALL** `routes.tsx:273-276` — stat cards hardcoded.
- [ ] **SMALL** `routes.tsx:573-576` — time inputs yield "20:00" while seed rows use "08:00 PM".
- [ ] **SMALL** `routes.tsx:504` — id built from `rows.length`; will collide once delete exists.
- [ ] **SMALL** `routes.tsx:58,333` — "Maintenance" offered as a route status.
- [ ] **SMALL** `routes.tsx:4,19` — unused imports `ArrowRight`, `Zap`.

## `/bookings` — `src/routes/bookings.tsx` (908 lines)

- [ ] **BIG** `bookings.tsx:706-739` — New Booking invents missing data (age 25, bus "TS 09 XX 0000", seat "L1", fixed times); no seat-availability or double-booking check; bus/route/seat are free text; one passenger and one seat only.
- [ ] **MED** `bookings.tsx:213-216` — Export button dead.
- [ ] **MED** `bookings.tsx:479-487` — row Download / Edit / Cancel buttons dead.
- [ ] **MED** `bookings.tsx:637-644` — sheet "Download Ticket" and "Cancel Booking" dead.
- [ ] **MED** `bookings.tsx:512-523` — pagination dead.
- [ ] **MED** `bookings.tsx:370-376` — "Journey Date" filter is a dropdown of dates present in rows, not a date picker.
- [ ] **MED** `bookings.tsx:708,756-838` — validation only checks non-empty; no phone format, negative amount accepted, date and times are free text.
- [ ] **SMALL** `bookings.tsx:509` — "of 3,256 bookings" hardcoded, contradicts 1,254; prints "1 to 0" when empty.
- [ ] **SMALL** `bookings.tsx:182-188,227-231` — stat cards hardcoded; ignore filters and new bookings; Confirmed + Cancelled = total leaves 0 Pending/Completed though table has them.
- [ ] **SMALL** `bookings.tsx:712` — random id; duplicates possible.
- [ ] **SMALL** `bookings.tsx:701-704` — `reset()` leaves many fields uncleared.
- [ ] **SMALL** `bookings.tsx:830-860` — manual booking can be created as source redBus/AbhiBus, status Cancelled/Completed, payment Refunded/Failed.
- [ ] **SMALL** `bookings.tsx:272,277` — `hsl(var(--background))` invalid; the vars are oklch.
- [ ] **SMALL** `bookings.tsx:432` — `pnr.slice(-10)` cuts mid-number.
- [ ] **SMALL** `bookings.tsx:574` — arrival shows the departure date on overnight trips.
- [ ] **SMALL** `bookings.tsx:898-907` — QR is a fixed fake pattern, identical for every ticket.
- [ ] **SMALL** `bookings.tsx:6,805-810` — unused `Calendar` import; bus-name options hardcoded.

## `/agents` — `src/routes/agents.tsx` (78 lines, stub)

- [ ] **BIG** `agents.tsx:23-78` — static read-only table; missing add/edit forms, commission edit, detail view, pagination, stats, empty state.
- [ ] **MED** `agents.tsx:30-32` — Add Agent button dead.
- [ ] **MED** `agents.tsx:39` — search input filters nothing.
- [ ] **MED** `agents.tsx:66-67` — Edit / Delete buttons dead.
- [ ] **SMALL** `agents.tsx:17-20,57` — balance/commission stored as formatted strings; row key is agent name.

## `/drivers` — `src/routes/drivers.tsx` (52 lines, stub)

- [ ] **BIG** `drivers.tsx:22-52` — read-only table; no add/edit/delete, search or actions; no bus/trip assignment; no conductors.
- [ ] **SMALL** `drivers.tsx:16-19` — experience as string ("8 yrs"); no licence expiry.

## `/settings` — `src/routes/settings.tsx` (100 lines)

- [ ] **MED** `settings.tsx:62-66` — five section links are `href="#"`; only Company Profile exists; Security, Billing, API & Webhooks sections do not exist.
- [ ] **MED** `settings.tsx:19-23,82-83` — Cancel / Save Changes dead; fields uncontrolled, no validation.
- [ ] **MED** `settings.tsx:35-40` — notification toggles cannot be switched.
- [ ] **SMALL** `settings.tsx:57-58,74-79` — company data and "Super Admin · Hyderabad" hardcoded.
- [ ] **SMALL** `settings.tsx:78-79` — Currency and Timezone are free-text inputs.

## `/seat-layouts` — `src/routes/seat-layouts.tsx` (720 lines)

- [ ] **BIG** `seat-layouts.tsx:93-184` — every bus renders the same hardcoded 42-seat sleeper grid, including the bus labelled "Seater (2+2)".
- [ ] **BIG** `seat-layouts.tsx:97-105,223-230` — screen mixes layout design with live booking status; no trip/date selector; booked seats and passenger names are random seed data.
- [ ] **BIG** `seat-layouts.tsx:270-276,474,692,699` — "Change Status", "Block Seat" and "Release Seat" all call `toggleBlock`: Release on an available seat blocks it; on a booked seat it wipes passenger and booking id with no confirmation.
- [ ] **MED** `seat-layouts.tsx:286-291` — Layout Templates / New Layout buttons dead.
- [ ] **MED** `seat-layouts.tsx:225,328-336` — Layout Type select is ignored by the grid.
- [ ] **MED** `seat-layouts.tsx:465` — Add Seat only fires a toast.
- [ ] **MED** `seat-layouts.tsx:471` — Edit Seat Number only fires a toast.
- [ ] **MED** `seat-layouts.tsx:477` — Save Layout only fires a success toast; nothing persists; switching bus or reloading discards edits silently.
- [ ] **MED** `seat-layouts.tsx:468` — Remove Seat deletes booked seats without confirmation.
- [ ] **MED** `seat-layouts.tsx:705-707` — "View Booking Details" dead; shown for unbooked seats too.
- [ ] **MED** `seat-layouts.tsx:122,146,172` — no control for price, female-reserved or seat type; prices hardcoded.
- [ ] **SMALL** `seat-layouts.tsx:126-128,150-152,176-178,684-685` — boarding/dropping shown for available/blocked seats; booking date hardcoded.
- [ ] **SMALL** `seat-layouts.tsx:260-262,543-544` — status filter removes seats from the grid, so rows collapse.
- [ ] **SMALL** `seat-layouts.tsx:491` — `window.innerWidth` read at render, not reactive.
- [ ] **SMALL** `seat-layouts.tsx:585,599` — native title and custom tooltip both show; tooltip likely clipped on first row (unverified).
- [ ] **SMALL** `seat-layouts.tsx:78,96` — `gender` never read; `statuses` array unused.
- [ ] **SMALL** `seat-layouts.tsx:298-302` — stat deltas print "100%" with an up-arrow.
- [ ] **SMALL** `seat-layouts.tsx:401-403,453` — "Fit to View" just resets zoom to 1.

## `/integrations` — `src/routes/integrations.tsx` (962 lines)

- [ ] **BIG** `integrations.tsx:206-228,307-329` — OTA API secret/password saved in plaintext to localStorage (`kenroute.ota.configs.v1`) while the toast claims "stored securely". **Security — fix early.**
- [ ] **BIG** `integrations.tsx:331-341` — Connect only sets local status "Pending"; "Connected"/"Error" are unreachable; Pending is lost on reload.
- [ ] **MED** `integrations.tsx:351-358` — Health Check / Request New Channel buttons dead.
- [ ] **MED** `integrations.tsx:572-575` — Refresh button dead.
- [ ] **MED** `integrations.tsx:435-457` — no disconnect, delete-credentials or test-connection control.
- [ ] **SMALL** `integrations.tsx:318,443` — Configure stays enabled while Pending; saving resets status.
- [ ] **SMALL** `integrations.tsx:847-848` — clearing Sync Interval stores "" and renders 0.
- [ ] **SMALL** `integrations.tsx:739-743` — fake 350 ms "Saving…".
- [ ] **SMALL** `integrations.tsx:117-123` — readiness numbers hardcoded and contradictory.
- [ ] **SMALL** `integrations.tsx:125-146,530-532` — Channel Performance static.
- [ ] **SMALL** `integrations.tsx:156-161,300-305` — activity log seeded; new entries lost on reload.
- [ ] **SMALL** `integrations.tsx:281,319,338,430` — "Last Sync" tile shows status text instead of a time.
- [ ] **SMALL** `integrations.tsx:673,684` — webhook URL defaults to hardcoded api.kenroute.com and is user-editable.
- [ ] **SMALL** `integrations.tsx:374-377` — "Coming Soon" banner hardcoded.

## `/reports` — `src/routes/reports.tsx` (880 lines)

- [ ] **BIG** `reports.tsx:454-522` — every figure is synthetic; the same calendar date shows different values depending on the range.
- [ ] **MED** `reports.tsx:551-559` — Export PDF / CSV / Excel have no handler.
- [ ] **MED** `reports.tsx:562-564` — Filters button dead.
- [ ] **MED** `reports.tsx:759,783,807` — View All Routes / Buses / Agents dead.
- [ ] **MED** `reports.tsx:870-872` — six Quick Reports download buttons dead.
- [ ] **SMALL** `reports.tsx:72-76` vs `101-107` — daily series and range revenue disagree; on "Today" Latest Day exceeds Range Revenue.
- [ ] **SMALL** `reports.tsx:580-608,820-841` — all deltas hardcoded.
- [ ] **SMALL** `reports.tsx:501` — expenses fixed at 57.6% of revenue.
- [ ] **SMALL** `reports.tsx:93-99,654-686` — Monthly and Yearly charts ignore the selected range; yearly ends at 2025.
- [ ] **SMALL** `reports.tsx:578` — label "Period Revenue (Latest Day)".
- [ ] **SMALL** `reports.tsx:531-533` — no breadcrumb.
- [ ] **SMALL** `reports.tsx:278` — `initialFocus` deprecated in react-day-picker v9.

---

## Working today (local state only)

List search and filters on buses, routes, bookings; booking detail sheet; add bus/route/booking to in-memory list; reports date presets and custom range; integrations configure dialog with zod validation; seat select, deck tabs, zoom; 404 page.

## Mock data to replace with API calls

| Location | Variable | Entity |
|---|---|---|
| `src/routes/index.tsx:60` | `revenueData` | revenue trend points |
| `src/routes/index.tsx:70` | `bookingTrend` | bookings per weekday |
| `src/routes/index.tsx:80` | `bookingSources` | bookings by channel |
| `src/routes/index.tsx:88` | `revenueSources` | revenue by channel |
| `src/routes/index.tsx:96` | `otaIntegrations` | OTA connection status cards |
| `src/routes/index.tsx:115` | `activityFeed` | recent activity |
| `src/routes/index.tsx:124` | `topRoutes` | top routes |
| `src/routes/index.tsx:157,164-168,327-330` | inline literals | date, KPI cards, live-ops stats |
| `src/routes/buses.tsx:69` | `initialRows` | buses |
| `src/routes/buses.tsx:318,346-350` | inline literals | total count, fleet stats |
| `src/routes/routes.tsx:75` | `initialRows` | routes |
| `src/routes/routes.tsx:273-276,454` | inline literals | route stats, total count |
| `src/routes/bookings.tsx:94` | `initial` | bookings |
| `src/routes/bookings.tsx:182` | `sourceTotals` | bookings/revenue by channel |
| `src/routes/bookings.tsx:227-231,509,805-810` | inline literals | booking stats, total, bus options |
| `src/routes/agents.tsx:16` | `rows` | agents |
| `src/routes/drivers.tsx:15` | `rows` | drivers |
| `src/routes/settings.tsx:57-58,74-79,90-93` | inline literals | company profile, notification prefs |
| `src/routes/seat-layouts.tsx:82` | `BUSES` | buses for layout picker |
| `src/routes/seat-layouts.tsx:93` | `seedSeats()` | seats, seat status, seat bookings |
| `src/routes/seat-layouts.tsx:331-334` | inline options | layout types |
| `src/routes/integrations.tsx:88` | `INITIAL` | OTA integrations |
| `src/routes/integrations.tsx:117` | `READINESS` | readiness checklist counts |
| `src/routes/integrations.tsx:125` | `CHANNELS` | channel performance |
| `src/routes/integrations.tsx:156` | `SEED_LOG` | sync activity log |
| `src/routes/integrations.tsx:206` | `STORAGE_KEY` (localStorage) | OTA credentials/config |
| `src/routes/reports.tsx:72` | `dailyTrendBase` | daily revenue |
| `src/routes/reports.tsx:78` | `monthlyTrend` | monthly revenue |
| `src/routes/reports.tsx:93` | `yearlyTrend` | yearly revenue |
| `src/routes/reports.tsx:101` | `sourceBase` | bookings/revenue by channel |
| `src/routes/reports.tsx:109` | `routeBase` | route performance |
| `src/routes/reports.tsx:117` | `busBase` | bus performance |
| `src/routes/reports.tsx:125` | `agentBase` | agent performance |
| `src/routes/reports.tsx:133` | `occupancyBase` | daily occupancy |
| `src/components/layout/Topbar.tsx:26,32-36` | inline literals | notification count, current user |
