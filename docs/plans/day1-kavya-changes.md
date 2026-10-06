# Change note for Kavya — Agent app, Day 1 (6 Oct)

Paste this into your AI tool after the main task sheet. Four business decisions arrived after the sheet was written. They change the API contract slightly and Task 6 (New Booking). Tasks 1 to 5 are unaffected.

## Contract changes

1. **Every seat has its own price.** In `GET /trips/:id/seats`, each seat now also has `"fare": "1250.00"` and `"ladiesOnly": false`. Upper and lower berths, and different seat types, can cost different amounts, and the owner can change prices per trip.
2. **Trip price is a "from" price.** In `GET /trips/search`, `fare` is now the lowest price among the seats still available on that trip.
3. **ID proof is compulsory.** In `POST /bookings`, every passenger must have `idProofType` and `idProofNumber`. Allowed types: `AADHAAR`, `PAN`, `DRIVING_LICENCE`, `VOTER_ID`, `PASSPORT`.
4. **Ladies-only seats.** A seat with `ladiesOnly: true` can only be booked for a passenger whose gender is `FEMALE`. The server rejects anything else with `VALIDATION_FAILED`.
5. **Bus type values.** `busType` is one of `AC_SLEEPER`, `NON_AC_SLEEPER`, `AC_SEATER`, `NON_AC_SEATER`, `AC_SEATER_SLEEPER`, `NON_AC_SEATER_SLEEPER`. There is no semi-sleeper.

Update `src/lib/api/types.ts` and `src/lib/api/mocks.ts` to match: give mock seats different fares for upper and lower deck, mark four seats `ladiesOnly`, and make the mock booking fail when a ladies-only seat gets a non-female passenger or when ID proof is missing.

## Changes to Task 6

- **Trip list:** show the price as "from ₹1,250".
- **Seat map:** show each seat's price (on the seat or in its tooltip). Add a "Ladies only" colour to the legend and use it for available `ladiesOnly` seats. They remain selectable.
- **Passenger form:**
  - ID proof type and number are required. Validate the number by type: Aadhaar exactly 12 digits; PAN 5 letters, 4 digits, 1 letter; others 5 to 20 letters or digits.
  - For a `ladiesOnly` seat, set gender to Female, lock the field, and show "This seat is reserved for women" beside it.
- **Summary:** list each seat with its own price. "Total to collect from passenger" is the sum of the selected seats' fares, not seats × one fare. Commission is that total × `commissionPct`.
- **Bus type labels:** one small function that turns the code into text, for example `NON_AC_SEATER_SLEEPER` → "Non-AC Seater/Sleeper".

## Extra checks

- Pick one upper and one lower seat with different prices → the summary total is the sum of the two.
- Pick a ladies-only seat → gender is locked to Female and cannot be changed.
- Leave ID proof empty → blocked with a field error. Aadhaar with 11 digits → blocked.

## Good to know (no work today)

- The Offers page will become **view only** for agents: they see the owner's active offer codes and apply one while booking. Creating and editing offers moves to the Admin app. Do not touch the Offers page yet.
- An agent only ever sees and cancels their own bookings. A booking cannot be moved to another seat or date; the agent cancels and books again. So no "Edit booking" anywhere.
- Test login is unchanged: `anil@srikrishna.test` / `Agent@123`.
