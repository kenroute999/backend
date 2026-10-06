# Questions for the CEO meeting

Purpose: get the decisions the team cannot make on its own. Questions marked **[BLOCKER]** stop work today if unanswered; ask those first. Write the answer next to each one during the meeting.

Opening line to use: "We are building all three apps in three days. To build the right thing, I need your decisions on how the business actually runs. Can you walk me through one normal day, from scheduling a bus to the bus arriving?"

## 1. The basic workflow (start here)

1. Walk me through one bus trip from start to finish today: who schedules it, who sells the seats, who collects the money, who checks passengers in.
2. Which of those steps is the most painful right now? What should KenRoute fix first?
3. Who will use each app on day one — how many owners, agents, conductors?
4. **[BLOCKER]** Is this for one bus company now, or several companies from the start?
5. What must work perfectly for the first demo, and what can be rough?

## 2. Buses, routes and trips

6. How many buses and routes do you run? What bus types (AC sleeper, non-AC sleeper, seater, semi-sleeper, others)? 

## as there is no owene now we lets take 3 seperate oenwers dummy test ones the buses would be based on the what onwere and main the people types buses have 2 types  first is ac and non ac  then based on seatinf type like sleeper , semi sleeper , seater  types 

7. Does the same bus run the same route every day, or does it change? Do you want "repeat this trip every day / on these weekdays"?

## it may vary like it may run on same routes and owner canmanually asing the routes or change it 

8. **[BLOCKER]** Is the price one fixed fare per route, or does it change by seat type (upper/lower, sleeper/seater), by day (weekend, festival), or by how full the bus is?

## it changes by the seat type and by the day and festuine i is variable 


9. Can a passenger board or get down at stops in between (for example Hyderabad → Kurnool on a Hyderabad → Bengaluru bus)? If yes, is the fare different?

## yes but he should board from the desinaes sto p he piced but can get down in between stops like like he book for pune to nashik his getdown point is  at  main nashik bustop but if he wants get down befre is like near nashik metro station and the debord he can get down but he can get execing he boaring poinr

10. Are some seats reserved for women? Any seats the owner keeps blocked (staff, VIP)?

## yeah some are reserved for women 

11. What happens when a bus breaks down or a trip is cancelled — who informs passengers, and what happens to their money?
## money refunds sent from then owner and he need to do it 

## 3. Agents and booking

12. Who are the agents — your own counter staff, outside travel agents, or both?

## its assigen byy then owners 

13. **[BLOCKER]** How is agent commission calculated: one percentage per agent, a different rate per route, or a fixed rupee amount per seat? Is it on the full fare or after discount?

## i need ask ceo

14. When an agent sells a ticket, who holds the cash — the agent, until they settle with you? How often do you settle (daily, weekly)?

## ceo 

15. Should an agent see only their own bookings, or everyone's?
## only his booking 


16. How long should a seat stay reserved while the agent fills in passenger details (we suggest 5 minutes)?


17. What passenger details are compulsory: name, age, gender, phone? Is ID proof required?
## name age number gender and id proof 

18. Can an agent cancel a booking? Until how long before departure? Is there a cancellation charge, and who keeps it?

## he can cancel his seats only 

19. Can a booking be changed (different seat, different date) instead of cancelled?

## no he need book new seat on the diffent date and time and cancel old 

20. Should agents be able to create discount codes, or only the owner? (The current Agent screen lets agents create them.)

## owner 

21. Do you want a limit on how much an agent can sell before settling (credit limit)?

## ceo

## 4. Tickets

22. What must be printed on the ticket? Do you have a format you use today that we should copy?
23. How does the passenger receive it: printout, WhatsApp, SMS, email?
24. Should the ticket message be sent automatically (needs a paid SMS/WhatsApp service) or is "agent taps share" enough for now?

## 5. Conductor and boarding

25. Does every bus have a conductor with an Android phone? Company phone or personal?

## his phone

26. Is one conductor fixed to one bus, or assigned trip by trip?

## assinged i guess 

27. Is scanning a QR code on the ticket realistic, or will most conductors just tick names on a list?

## realisct scanning 

28. Can the conductor sell a seat on the bus to a walk-in passenger? If yes, who gets the cash?

## no selling 

29. What should happen to passengers who do not show up — is the seat released, is there a refund?

## no refund 

30. Should the conductor see fares and phone numbers, or only names and seats?

## no 

31. Do you need the driver in the system as a user, or just their name on the trip?

## we add diricver deatils in admin page naa l

## 6. redBus, AbhiBus and other channels

32. Are you already selling on redBus and AbhiBus today? Any others (MakeMyTrip, Paytm, own website)?
## no we need to build this first then inegrate rebdus and abhi bus 

33. **[BLOCKER]** Do you have API access from them, or only their operator portal login? (If only the portal, we import their booking file until API access is arranged.)

## no 

34. Can you give us a sample booking export file from each portal today? We need the real columns.

## we dont have it 

35. How do you stop the same seat being sold on redBus and by an agent at the same time today? Do you give each channel a fixed set of seats?

## like we need dicuss this claude like agent and these all have the seats bro we need have like on one book same at time type 

36. What commission do redBus and AbhiBus take, and when do they pay you?

## dont know 

## 7. Money and payments

37. **[BLOCKER]** Payments are paused until you provide the Razorpay account. Confirm: for now KenRoute only records money, it does not collect it. Correct?

like here we basically build seperate seperate like based on owner he gives me 

38. When Razorpay comes, what should it be used for: passengers paying online, agents topping up a wallet, you paying agents — which ones?

39. Do you have the Razorpay account, business documents and bank details ready, and by when?
40. Does an agent "withdraw" commission inside the app, or do you simply pay them and mark it paid?
41. Is GST shown on the ticket? Do you need GST invoices or reports?

## 8. Dashboard and reports

42. **[BLOCKER]** What counts as revenue: does a cancelled or refunded booking count? Do we show the full fare, or the amount after redBus/AbhiBus commission?
43. Which five numbers do you want to see first thing every morning?
44. Which reports do you actually use today (daily sales, route-wise, agent-wise, bus-wise)? Who do you send them to, and in what format (Excel, PDF)?
45. Do you need to compare periods (this week vs last week)?

## 9. Users, access and security

46. Besides the owner, are there managers or accountants who need Admin access with fewer rights?
47. Who creates and removes agent and conductor accounts?
48. Is email and password login acceptable, or must it be mobile number and OTP? (OTP needs a paid SMS service.)
49. Do you need a second login step (code on phone) for the owner?
50. Which languages must the apps support — English only, or Telugu / Hindi / Kannada as well?

## 10. Launch, hosting and ownership

51. What exactly must be delivered at the end of the three days — a demo, or real use by your staff the next morning?
52. Who pays for and owns the AWS account, the domain name and the Play Store account? Can we get access today?
53. What website address should the apps live on?
54. Do you have existing data to load (buses, routes, agents, past bookings)? In what form?
55. Who is our single point of contact for questions during these three days, and how fast can they answer?
56. After launch, who reports problems and who fixes them?

## 11. Close the meeting with these

57. "If we can finish only one of these three in time, which matters most: agents booking, the conductor app, or your dashboard?"
58. "Is there anything you expect to see that we have not talked about?"
59. Read back the blocker answers (4, 8, 13, 33, 37, 42) and get a clear yes.

## What we will assume if there is no answer

So work does not stop, these defaults are being built now and are cheap to change in the first day, expensive later:

| Topic | Default being built |
|---|---|
| Companies | Several companies supported, one in use |
| Fare | One fare per trip, copied from the route, owner can change it per trip |
| In-between stops | Boarding and dropping points recorded, same fare |
| Commission | One percentage per agent, on the full fare |
| Seat hold | 5 minutes |
| Cancellation | Agent can cancel their own booking until departure; no charge recorded |
| OTA channels | Booking file import (CSV); live connection later |
| Payments | Record only; Cash and UPI as labels; Razorpay later |
| Revenue | Confirmed, boarded and completed bookings at full fare; cancelled and refunded excluded |
| Login | Email and password |
| Languages, second login step | English only; not in this release |
| Conductor app | Android only |
