# Agent app — frontend audit

App folder: `agent/` · Dev URL: http://127.0.0.1:3002 · Audited 2026-10-05 by reading code (not browser-tested; items marked "unverified" need a visual check).

**Totals: 30 BIG / 80 MED / 85 SMALL**

- **BIG** = feature missing or broken
- **MED** = control does nothing
- **SMALL** = cosmetic, label, leftover

Tick a box when fixed. All paths are relative to `agent/`.

---

## Global / shell

- [ ] **BIG** `src/routes/` (whole dir) — no sign-in route and no auth guard; all 10 pages are public.
- [ ] **BIG** `src/routes/__root.tsx:112-118` — QueryClientProvider mounted but no route has a query, loader or fetch; all data is module-level constants.
- [ ] **BIG** all routes — no shared state between screens: each route has its own private mock array, so nothing done on one screen can appear on another.
- [ ] **BIG** `src/components/AgentShell.tsx:97-98` — identity "Anil Agent / AGT1024" hardcoded; repeated at `index.tsx:102`, `booking-history.tsx:212`, `tickets.tsx:224`, `settings.tsx:135`, `support.tsx:261`.
- [ ] **MED** `src/components/AgentShell.tsx:75` — Logout button has no onClick.
- [ ] **MED** `src/components/AgentShell.tsx:86` — bell button has no onClick.
- [ ] **MED** `src/components/AgentShell.tsx:92-101` — user chip with ChevronDown looks like a menu, opens nothing.
- [ ] **MED** `src/components/AgentShell.tsx:37` — sidebar hidden below 1024px with no mobile menu; no navigation at all on smaller screens.
- [ ] **MED** all routes — no `<Toaster>` mounted (sonner installed, unused), so no action can show success or error feedback.
- [ ] **MED** `src/components/AgentShell.tsx:71` — sidebar wallet balance ₹12,450.00 is a literal; same value separately hardcoded at `index.tsx:50`, `wallet.tsx:223`, `wallet.tsx:299`, `wallet.tsx:45`.
- [ ] **MED** all routes — no per-route loading or error component.
- [ ] **MED** `booking-history.tsx:534`, `tickets.tsx:547`, `passengers.tsx:495`, `offers.tsx:73`, `support.tsx:84` — five hand-rolled drawers with no Esc close, no focus trap, no `role="dialog"`.
- [ ] **SMALL** `src/components/AgentShell.tsx:37` — sidebar not sticky; on long pages nav scrolls away and Logout sits at the very bottom.
- [ ] **SMALL** `src/components/AgentShell.tsx:88-90` — notification badge "3" hardcoded; dashboard lists 4 notifications.
- [ ] **SMALL** `src/components/AgentShell.tsx:97` — "Anil Agent" contradicts Settings full name "Anil Kumar Reddy" (`settings.tsx:131`).
- [ ] **SMALL** `src/routes/__root.tsx:75-82` — title "Lovable App", description "Lovable Generated Project", author "Lovable".
- [ ] **SMALL** 8 of 10 pages have no `head`, so the tab title is "Lovable App" (`booking-history`, `tickets`, `passengers`, `wallet`, `reports`, `offers`, `support`, `settings`).
- [ ] **SMALL** `package.json:2` — name `tanstack_start_ts`; leftovers: `src/lib/api/example.functions.ts`, `src/routes/README.md`, `.lovable/`.
- [ ] **SMALL** `src/components/AgentShell.tsx:50`, `index.tsx:145` — `to={to as "/"}` type escape disables route type-checking.
- [ ] **SMALL** all tables — no sort control on any table.
- [ ] **SMALL** `src/routes/__root.tsx:13-33` — 404 page renders outside AgentShell (no sidebar).
- [ ] **SMALL** cross-screen — ID formats disagree: bookings `KR10421`, `KR-2026-10481`, `BK20451`; PNR `PNR8842051` vs `KR82145`.
- [ ] **SMALL** cross-screen — seat formats disagree (`L10`, `L-12`, `U12`/`L08`); bus numbers disagree; Vijayawada is `VJA` and `VIJ`.
- [ ] **SMALL** cross-screen — dashboard shows real current date while mock data is May 2026 and the new-booking journey is 20 May 2025.

## `/` Dashboard — `src/routes/index.tsx` (483 lines)

- [ ] **BIG** `index.tsx:45-91` — every number static; a new booking cannot change stats, recent bookings, commission, occupancy or notifications.
- [ ] **MED** `index.tsx:474` — Passenger Search "Search" button has no onClick; no result area exists.
- [ ] **MED** `src/components/booking-source/index.tsx:240-276` — Inventory Sync card (redBus/AbhiBus status) is static and is owner-level info shown in the agent app.
- [ ] **SMALL** `index.tsx:479` — tip mentions scanning a ticket QR from New Booking; no such feature.
- [ ] **SMALL** `index.tsx:255` — "Live occupancy" label on static data.
- [ ] **SMALL** `index.tsx:71` vs `new-booking.tsx:50-95` — HYD→BLR shows 32 sold of 48; seat map for same route has 27 taken.
- [ ] **SMALL** `index.tsx:62` vs `booking-history.tsx:73` — fare ₹1,250 on dashboard/new-booking, ₹1,450 in history/tickets/passengers.
- [ ] **SMALL** `index.tsx:61-68` — recent-booking passengers and IDs do not exist in Booking History data.
- [ ] **SMALL** `index.tsx:49` — "Total Passengers 56"; Passengers page says 2,184; Reports says 3,021.
- [ ] **SMALL** `index.tsx:200-208` — recent-booking rows not clickable.
- [ ] **SMALL** `index.tsx:344-350` — StatusBadge map has no "Completed"; unknown status renders class `undefined`.
- [ ] **SMALL** `index.tsx:89-91` — week chart fixed Mon–Sun with Sun as "today".
- [ ] **SMALL** `index.tsx:105` — `new Date()` during SSR; possible hydration mismatch (unverified).
- [ ] **SMALL** `src/components/booking-source/index.tsx:169-181` — pie arc draws nothing when one source is 100%; donut hole hardcoded white.
- [ ] **SMALL** `index.tsx:46-50` — deltas hardcoded.

## `/new-booking` — `src/routes/new-booking.tsx` (624 lines), `BusSeatMap.tsx` (137 lines)

- [ ] **BIG** `new-booking.tsx:476-482` — "Generate Ticket" has no onClick: no booking, no ticket, no confirmation.
- [ ] **BIG** whole flow — a booking cannot reach History, Tickets, Dashboard, Passengers or Wallet.
- [ ] **BIG** `new-booking.tsx:184-205` — no trip search: route, date, bus, times hardcoded; agent cannot choose.
- [ ] **BIG** `new-booking.tsx:289-343` — no passenger validation; submit enabled with all fields empty.
- [ ] **BIG** `new-booking.tsx:50-95` — seat availability generated in the client; no hold/lock, no conflict check.
- [ ] **MED** `new-booking.tsx:110-111,181` — `SeatConflictBanner` is unreachable.
- [ ] **MED** `new-booking.tsx:117-128` — page loads with seat L10 preselected and a prefilled passenger.
- [ ] **MED** `new-booking.tsx:237` — "Refresh" button dead.
- [ ] **MED** `new-booking.tsx:350` — "Add Another Passenger" dead.
- [ ] **MED** `new-booking.tsx:361-375,469` — Boarding Point, Dropping Point, Notes, Payment Mode values captured nowhere.
- [ ] **MED** `new-booking.tsx:109,182` — `bookingSource` selectable but used by nothing.
- [ ] **MED** `new-booking.tsx:408-413` — validation panel turns "Verified" as soon as one seat is selected, even with empty passenger fields.
- [ ] **MED** `new-booking.tsx:456-467` — amount the passenger pays never shown as total; no tax, discount or coupon line.
- [ ] **MED** `new-booking.tsx:48` vs `reports.tsx:31-32,51` — commission 10% here, 5% in Reports.
- [ ] **MED** `new-booking.tsx:469-474` — "Wallet" payment mode offered with no balance check.
- [ ] **MED** `src/components/booking/BusSeatMap.tsx:23` — layout hardcoded to 4 rows × 6 seats; seats beyond 24 per deck silently dropped; no aisle or seat-type support.
- [ ] **MED** `src/components/booking-source/index.tsx:310-331` — "Inventory Status / OTA Sync Status" is static text.
- [ ] **SMALL** `new-booking.tsx:198` vs `BusSeatMap.tsx:22-23` — bus described as "Sleeper (2+1)" but drawn as a 6-wide grid.
- [ ] **SMALL** `new-booking.tsx:197-200` — journey year 2025.
- [ ] **SMALL** `new-booking.tsx:201` vs `361-365` — header boarding point not linked to the Boarding Point select.
- [ ] **SMALL** `new-booking.tsx:168` — "Available Seats" does not decrease when seats are selected.
- [ ] **SMALL** `new-booking.tsx:210-216,417-422` — same six counts rendered twice; Seat Legend rendered twice.
- [ ] **SMALL** `new-booking.tsx:417` vs `444` — "Total Seats" means capacity in one card, selected count in the next.
- [ ] **SMALL** `new-booking.tsx:130-156` — `setPassengers` called inside the `setSelected` updater.
- [ ] **SMALL** `new-booking.tsx:445,448,456,459,465` — `toLocaleString()` without locale.
- [ ] **SMALL** `new-booking.tsx:57-68,80-91` — every booked male seat shows same passenger name; tooltip hover-only.
- [ ] **SMALL** `new-booking.tsx:280-285` — remove-passenger icon button has no title or aria-label.

## `/booking-history` — `src/routes/booking-history.tsx` (665 lines)

- [ ] **BIG** `booking-history.tsx:72-85` — list is a static 12-row array; nothing is ever added or changed.
- [ ] **BIG** `booking-history.tsx:380-382,623-626` — Cancel Booking (row and drawer) dead; no cancel flow exists.
- [ ] **MED** `booking-history.tsx:217-220` — Export CSV dead.
- [ ] **MED** `booking-history.tsx:221-224` — Export PDF dead.
- [ ] **MED** `booking-history.tsx:371-379` — row actions Reprint, Download PDF, Contact Passenger dead.
- [ ] **MED** `booking-history.tsx:611-622` — drawer buttons Reprint, Download PDF, Contact dead.
- [ ] **MED** `booking-history.tsx:262-265` — "Search" button dead (filtering happens on typing).
- [ ] **MED** `booking-history.tsx:172,270` — Journey Date is free text matched exactly; not a date picker.
- [ ] **MED** `booking-history.tsx:175-178` — mobile search fails for `9876543210` because data is `+91 98765 43210`. Same on `tickets.tsx:176-179,215` and `passengers.tsx:287,291`.
- [ ] **MED** `booking-history.tsx:171,198,349` — booking source is a hash of the booking ID, not data; same booking shows "Counter" here and "Agent" on Tickets.
- [ ] **MED** `booking-history.tsx:43-61` — `Booking` type holds one passenger and one seat; new-booking allows many.
- [ ] **SMALL** `booking-history.tsx:380,623` — Cancel shown for already Cancelled or Completed bookings.
- [ ] **SMALL** `booking-history.tsx:401` — "8 per page" hardcoded.
- [ ] **SMALL** `booking-history.tsx:581` — QR is a generic icon.
- [ ] **SMALL** `booking-history.tsx:301` — table min width 1300px; scrolls horizontally on 1440px screens.
- [ ] **SMALL** `booking-history.tsx:665` — `void MoreHorizontal` to silence unused import.
- [ ] **SMALL** `booking-history.tsx:79` vs `tickets.tsx:72` — TKT784506 has different date/status on the two screens.
- [ ] **SMALL** `booking-history.tsx:230-233` — stat cards ignore active filters.

## `/tickets` — `src/routes/tickets.tsx` (697 lines)

- [ ] **BIG** `tickets.tsx:65-76` — static 10-row array, separate from bookings although they share ticket numbers.
- [ ] **BIG** `tickets.tsx:454-456,646-649` — Reprint (row and drawer) dead; no print view.
- [ ] **BIG** `tickets.tsx:466-468` — Cancel Ticket dead.
- [ ] **MED** `tickets.tsx:229-232` — Export CSV dead.
- [ ] **MED** `tickets.tsx:233-236` — Export PDF dead.
- [ ] **MED** `tickets.tsx:457-459,650-653` — Download PDF (row and drawer) dead.
- [ ] **MED** `tickets.tsx:460-462,654-657` — WhatsApp share (row and drawer) dead.
- [ ] **MED** `tickets.tsx:463-465,658-661` — Email (row and drawer) dead.
- [ ] **MED** `tickets.tsx:361-366` — Quick Reprint only opens the view drawer.
- [ ] **MED** `tickets.tsx:192` — "Today's Tickets" compares against literal "30 May 2026" and uses journey date while card says "Issued today".
- [ ] **MED** `tickets.tsx:41` — "Reprinted" is a ticket status exclusive with Active/Used; contradicts history.
- [ ] **SMALL** `tickets.tsx:466` — Cancel shown for Cancelled and Used tickets.
- [ ] **SMALL** `tickets.tsx:614` — QR is a generic icon.
- [ ] **SMALL** `tickets.tsx:226` — "issued through your counter" wording.
- [ ] **SMALL** `tickets.tsx` — no date filter.

## `/passengers` — `src/routes/passengers.tsx` (651 lines)

- [ ] **BIG** `passengers.tsx:47-221` — static 8 rows; no Add Passenger control.
- [ ] **BIG** `passengers.tsx:433-438,639-641` — Edit (row and drawer) dead; no edit form.
- [ ] **MED** `passengers.tsx:446-451,636-638` — Contact (row and drawer) dead.
- [ ] **MED** `passengers.tsx:642-644` — drawer "New Booking" dead, does not link to `/new-booking`, uses Wallet icon.
- [ ] **MED** `passengers.tsx:439-445` — "Journey History" opens the same drawer as View Profile.
- [ ] **MED** `passengers.tsx:305-308` — stat cards hardcoded (2,184 / 1,742 / 138 / 68%) against 8 rows.
- [ ] **MED** `passengers.tsx:417-423` — "Customer Type" is fabricated from a hash of the passenger ID.
- [ ] **SMALL** `passengers.tsx:297-298` — page not clamped; can show an empty page 2 of 1.
- [ ] **SMALL** `passengers.tsx:305` vs `reports.tsx:30,33` — "Total Passengers 2,184" equals Reports "Total Bookings 2,184".
- [ ] **SMALL** `passengers.tsx:51,100,164` — same mobile number belongs to different people across screens.
- [ ] **SMALL** `passengers.tsx:68` vs `booking-history.tsx:73` — Ravi Kumar's last trip differs between screens.
- [ ] **SMALL** `passengers.tsx:44` — `history[].status` defined, never displayed.
- [ ] **SMALL** `passengers.tsx:194,306` — passenger who travelled 15 May 2026 marked "Inactive".

## `/wallet` — `src/routes/wallet.tsx` (484 lines)

- [ ] **BIG** `wallet.tsx:228-230,324-326` — both Withdraw buttons dead; amount input has no min/max check.
- [ ] **BIG** whole page — withdraw, add funds, linked bank account contradict the backend spec (record-only; owner marks commission paid). **Decision needed: keep or remove.**
- [ ] **MED** `wallet.tsx:231-233` — "Add Funds" dead.
- [ ] **MED** `wallet.tsx:203,364-373` — date-range select is never read by the filter.
- [ ] **MED** `wallet.tsx:388-390` — Transactions "Export" dead.
- [ ] **MED** `wallet.tsx:448-450` — Payouts "Export" dead.
- [ ] **MED** `wallet.tsx:162-169` — monthly chart uses `hsl(var(--brand-green))` but the var is oklch; invalid colour, line does not render.
- [ ] **MED** `wallet.tsx:303-311` — bank details hardcoded with no way to change.
- [ ] **SMALL** `wallet.tsx:240` vs `255` — Weekly Commission ₹26,890 vs daily chart total ₹25,630.
- [ ] **SMALL** `wallet.tsx:21-26` vs `339` — "Avg per Booking" ₹151 vs computed ₹364.
- [ ] **SMALL** `wallet.tsx:337-338` vs `241` — Pending + Cleared does not equal monthly total.
- [ ] **SMALL** `wallet.tsx:267` — "↑ 22% YoY" on a 6-month chart.
- [ ] **SMALL** `wallet.tsx:60` — older payout still "Processing" while newer ones Completed.
- [ ] **SMALL** `wallet.tsx:57-63` vs `44-55` — five payouts listed, only one debit in transactions.
- [ ] **SMALL** `wallet.tsx:407-435` — no pagination or empty state on transactions.

## `/reports` — `src/routes/reports.tsx` (299 lines)

- [ ] **BIG** `reports.tsx:120-121,132-137` — From/To dates used by nothing; every figure static.
- [ ] **MED** `reports.tsx:142-147` — Route select filters nothing.
- [ ] **MED** `reports.tsx:151-156` — Status select filters nothing.
- [ ] **MED** `reports.tsx:159-161` — CSV button dead.
- [ ] **MED** `reports.tsx:162-164` — PDF button dead.
- [ ] **MED** `reports.tsx:165-167` — Download button dead.
- [ ] **MED** `reports.tsx:259-261` — Daily Sales "Export" dead.
- [ ] **SMALL** `reports.tsx:30` vs `288` — stat card says 2,184 bookings; daily table for same range totals 643.
- [ ] **SMALL** `reports.tsx:178` — "Last 14 days" subtitle fixed; no axis labels.
- [ ] **SMALL** `reports.tsx:196` — bar width divides by hardcoded 412.
- [ ] **SMALL** `reports.tsx:41-48` vs `booking-history.tsx:63-70` — route lists differ.
- [ ] **SMALL** `reports.tsx:204,213` — duplicated comment above wrong block.
- [ ] **SMALL** `reports.tsx:86-98` — `stroke="var(--brand-green)"` as SVG attribute (unverified).
- [ ] **SMALL** `reports.tsx:30-34` — all deltas hardcoded.

## `/offers` — `src/routes/offers.tsx` (274 lines)

- [ ] **BIG** whole page — agent can "Create Offer" with coupon codes; spec does not give agents this, reads as an owner feature. No way to apply a coupon in `/new-booking`. **Decision needed.**
- [ ] **BIG** `offers.tsx:132` — "Create Offer" submit dead; drawer inputs uncontrolled and lost on close.
- [ ] **MED** `offers.tsx:215` — Edit (pencil) dead.
- [ ] **MED** `offers.tsx:216` — Delete (trash) dead.
- [ ] **MED** `offers.tsx:198` — Copy icon looks clickable, no onClick.
- [ ] **SMALL** `offers.tsx:47-50` — stats hardcoded; "Total Coupons 47" against 7 rows.
- [ ] **SMALL** `offers.tsx:99` vs `28` — "Flat Amount" vs "Flat".
- [ ] **SMALL** `offers.tsx:244` — bar width divides by hardcoded 1284.
- [ ] **SMALL** `offers.tsx:266` — chart axis labels hardcoded.
- [ ] **SMALL** `offers.tsx:37-43` — status is a stored literal, not derived from dates.
- [ ] **SMALL** `offers.tsx:189` — no search, filter or pagination.

## `/support` — `src/routes/support.tsx` (280 lines)

- [ ] **BIG** `support.tsx:132` — "Submit Ticket" dead; drawer inputs lost on close.
- [ ] **BIG** `support.tsx:248-275` — live chat is fake: canned bubbles, Send button dead, static "Online".
- [ ] **MED** `support.tsx:125-127` — Attachments drop zone has no file input.
- [ ] **MED** `support.tsx:166` — five category cards dead.
- [ ] **MED** `support.tsx:204` — ticket rows look clickable, no detail view.
- [ ] **MED** `support.tsx:228` — five Knowledge Base items dead; no article content.
- [ ] **SMALL** `support.tsx:49-51` vs `38-46` — stats do not match the table.
- [ ] **SMALL** `support.tsx:42` — sample ticket "How to add new route to my panel?" is an owner action.
- [ ] **SMALL** `support.tsx:56,58` — two categories use the same icon.
- [ ] **SMALL** `support.tsx:92,254` — "within 2 hours" and "~2 min" are hardcoded promises.
- [ ] **SMALL** `support.tsx:203` — no search, filter or pagination.

## `/settings` — `src/routes/settings.tsx` (296 lines)

- [ ] **BIG** `settings.tsx:77-85` — every setting lives in local state and resets on navigation or reload.
- [ ] **BIG** `settings.tsx:159-163` — Change Password: "Update Password" dead, no match or strength check.
- [ ] **MED** `settings.tsx:148` — "Save Changes" dead.
- [ ] **MED** `settings.tsx:147` — "Cancel" dead.
- [ ] **MED** `settings.tsx:115-117,123,124` — camera, Upload, Remove buttons dead.
- [ ] **MED** `settings.tsx:83,247` — theme choice does nothing.
- [ ] **MED** `settings.tsx:84,277` — language choice does nothing.
- [ ] **MED** `settings.tsx:168` — 2FA toggle is local state with no OTP flow.
- [ ] **MED** `settings.tsx:186` — "Revoke" dead; session list hardcoded.
- [ ] **MED** `settings.tsx:229-231` — "Download Sample" dead.
- [ ] **MED** `settings.tsx:221-226` — Default Delivery Channel select uncontrolled.
- [ ] **SMALL** `settings.tsx:197-200,207,214` — toggles affect nothing else in the app.
- [ ] **SMALL** `settings.tsx:41-45` — Toggle has no `role="switch"` or `aria-checked`.
- [ ] **SMALL** `settings.tsx:114` — avatar "A" hardcoded.
- [ ] **SMALL** `settings.tsx` — spec lists "change settings" as not permitted for Agent; which settings that covers is unverified.

---

## Working today (local state only)

Seat toggle, multi-select, deck switch, remove passenger, fare recalculation; booked and blocked seats cannot be picked. Search, filters, pagination, view drawers on history, tickets, passengers. Wallet All/Credit/Debit filter.

## Mock data to replace with API calls

| Location | Variable | Entity |
|---|---|---|
| `src/components/AgentShell.tsx:71` | literal | sidebar wallet balance |
| `src/components/AgentShell.tsx:89` | literal `3` | unread notification count |
| `src/components/AgentShell.tsx:94-98` | literals | agent name, initial, agent ID |
| `src/components/booking-source/index.tsx:70` | `sourceFor()` | fake booking-source derivation |
| `src/components/booking-source/index.tsx:240-276` | `InventorySyncCard` literals | OTA sync status |
| `src/components/booking-source/index.tsx:310-331` | `InventoryStatusBanner` literals | inventory status |
| `src/routes/index.tsx:27` | `DASHBOARD_SOURCE_STATS` | today's bookings/revenue per source |
| `src/routes/index.tsx:45` | `stats` | dashboard KPI cards |
| `src/routes/index.tsx:61` | `recentBookings` | recent bookings |
| `src/routes/index.tsx:70` | `routeSummary` | per-route occupancy |
| `src/routes/index.tsx:76` | `commissions` | commission today/week/month |
| `src/routes/index.tsx:82` | `notifications` | notification feed |
| `src/routes/index.tsx:89-91` | `weekBookings`, `weekRevenue`, `weekLabels` | 7-day chart series |
| `src/routes/new-booking.tsx:47-48` | `SEAT_FARE`, `COMMISSION_RATE` | fare and commission rate |
| `src/routes/new-booking.tsx:50` | `makeLowerDeck()` | lower-deck seat inventory |
| `src/routes/new-booking.tsx:74` | `makeUpperDeck()` | upper-deck seat inventory |
| `src/routes/new-booking.tsx:117-128` | initial state | prefilled demo passenger |
| `src/routes/new-booking.tsx:188-204` | JSX literals | trip (route, date, bus, times) |
| `src/routes/new-booking.tsx:362-371` | JSX options | boarding and dropping points |
| `src/routes/new-booking.tsx:397-400` | JSX literals | bus amenities |
| `src/routes/booking-history.tsx:63` | `ROUTES` | route filter options |
| `src/routes/booking-history.tsx:72` | `BOOKINGS` | bookings |
| `src/routes/tickets.tsx:65` | `TICKETS` | tickets |
| `src/routes/tickets.tsx:192` | literal "30 May 2026" | "today" |
| `src/routes/passengers.tsx:47` | `PASSENGERS` | passengers with history |
| `src/routes/passengers.tsx:305-308` | literals | passenger KPI cards |
| `src/routes/wallet.tsx:21` | `WALLET_SOURCE_STATS` | commission per source |
| `src/routes/wallet.tsx:44` | `TRANSACTIONS` | commission ledger |
| `src/routes/wallet.tsx:57` | `PAYOUTS` | payouts |
| `src/routes/wallet.tsx:65` | `DAILY` | daily commission |
| `src/routes/wallet.tsx:75` | `MONTHLY` | monthly earnings |
| `src/routes/wallet.tsx:223,239-242,255,267,299,309-310,337-340` | literals | balance, KPIs, bank account |
| `src/routes/reports.tsx:18` | `REPORT_SOURCE_STATS` | bookings/revenue per source |
| `src/routes/reports.tsx:29` | `STATS` | report KPI cards |
| `src/routes/reports.tsx:37-39` | `DAILY_BOOKINGS`, `REVENUE_TREND`, `COMMISSION_TREND` | 14-day series |
| `src/routes/reports.tsx:41` | `TOP_ROUTES` | route performance |
| `src/routes/reports.tsx:50` | `SALES_REPORT` | daily sales rows |
| `src/routes/reports.tsx:143-146` | JSX options | route filter list |
| `src/routes/offers.tsx:36` | `OFFERS` | offers/coupons |
| `src/routes/offers.tsx:46` | `STATS` | offer KPI cards |
| `src/routes/offers.tsx:53` | `TOP_COUPONS` | coupon usage ranking |
| `src/routes/offers.tsx:61` | `REDEMPTION_TREND` | 14-day redemptions |
| `src/routes/support.tsx:38` | `TICKETS` | support tickets |
| `src/routes/support.tsx:48` | `STATS` | support KPI cards |
| `src/routes/support.tsx:55` | `CATEGORIES` | support categories |
| `src/routes/support.tsx:63` | `KB` | knowledge-base articles |
| `src/routes/support.tsx:260-268` | JSX literals | chat messages |
| `src/routes/settings.tsx:77-85` | `useState` defaults | agent preferences |
| `src/routes/settings.tsx:131-143` | `defaultValue` literals | agent profile |
| `src/routes/settings.tsx:175-177` | inline array | login sessions |
