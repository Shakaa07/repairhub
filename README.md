# RepairHub MVP

A working minimum viable product for **RepairHub**, a service for home repairs in Astana with checked specialists, a price before the visit and help if the work goes wrong. Built for Assignment 5 (Technological Entrepreneurship) by Zeinebek Karlygash, Yelemes Shattyk and Semikanuly Adil.

## Run it

Requires **Node.js 18 or newer**. There is nothing to install.

```bash
node server.js
```

| Page | Address |
|---|---|
| Public site | http://localhost:3000 |
| Team dashboard | http://localhost:3000/admin.html (password `repairhub`) |

Phones on the same Wi-Fi can open the address that the server prints at start, for example `http://192.168.1.15:3000`. This is how the team runs beta tests with real users.

Optional settings: `PORT=4000`, `ADMIN_PASSWORD=yourpassword`, `DATA_FILE=/path/db.json`.

Run the automated tests with `node --test`.

## What it does

| User | Feature |
|---|---|
| Owner, tenant or landlord | Sends a repair request in about 2 minutes and sees a starting price for the category |
| Landlord | Labels each request with a flat, and sees all flats and their statuses on **My requests** |
| Customer | Tracks the status, sees the matched specialist, rates the job and reports a problem within 30 days |
| Specialist | Applies with categories and experience; the team checks and approves |
| Team (concierge) | Approves specialists, assigns them to requests, moves statuses, exports CSV and watches the funnel |

The matching is done manually by the team (a concierge MVP), so the team can learn from every order before automating it.

## Metrics collected (for the HADI cycle)

Visits → request form opens → requests sent → completed jobs → feedback, plus requests by role and category, average rating, the share of users who would pay in the app with a guarantee, and the number of problem reports. All data is stored in `data/db.json`, which is created on the first request.

## Project structure

```
server.js            HTTP server, API, validation and JSON storage (no dependencies)
public/index.html    Landing page with value proposition and starting prices
public/request.html  Repair request form with instant starting price
public/track.html    Customer and landlord tracking, feedback and problem reports
public/specialist.html  Specialist application
public/admin.html    Team dashboard: metrics, funnel, requests, specialists, feedback, claims
public/app.js        Shared front-end helpers
public/styles.css    Styles (RepairHub orange and dark palette, mobile friendly)
test/smoke.test.js   End-to-end API test of the full customer journey
```

## Sources for starting prices

- Plumbing from 9,000 ₸: Naimi.kz catalog, Astana (accessed October 2026).
- Electrical call-out from 5,000 ₸: Kazinform (2025), "Сколько стоят услуги электриков и сантехников в Казахстане".

Other categories show "fixed price after photo review" because no reliable public price was found.
