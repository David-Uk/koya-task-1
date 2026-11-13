# Koya Clinic Booking API

A clinic booking API built with **Express** and **Mongoose**, plus a single-page
frontend that lists available slots, books a slot, and shows the confirmation.

The API follows the Koya Cohort 4 Task 1 contract:
<https://koyaacademy.com/assessment-api>

## Features (all five levels)

| Level | Requirement | Implementation |
| ----- | ----------- | -------------- |
| 1 | List slots, book, look up a booking | `GET /slots`, `POST /bookings`, `GET /bookings/:id`, `POST /reset` |
| 2 | API-key auth and input validation | `X-API-Key` header on every endpoint; required fields, email format, trimmed values, lower-cased email |
| 3 | No double booking, cancellation | Partial unique index `{ slot_id: 1 }` where `status: "confirmed"`; `DELETE /bookings/:id` |
| 4 | Idempotency and pagination | `Idempotency-Key` header; cursor pagination via `email`, `limit`, `cursor` |
| 5 | Spam protection | 5 attempts per email per 60s in MongoDB; 6th returns `429` with `Retry-After` |

Every error response uses the contract shape `{ "error": "<message>" }`.

## Project structure

```
server/app.js                  Express bootstrap, security, static frontend
api/index.js                  Vercel serverless entry point
api/[...path].js              Vercel catch-all entry point
vercel.json                   Root-path rewrites for Vercel
.env                          Local secrets (not committed)
.env.example                  Template for the environment variables
controllers/
  bookingController.js        Booking, cancel, lookup, idempotency, rate limit
  slotController.js           Slot listing and availability
models/
  bookingModel.js             Booking schema + partial unique index
  slotModel.js                Slot schema
  idempotencyKeyModel.js      Idempotency records (24h TTL)
  rateLimitModel.js           Shared per-email rate-limit state
routes/
  apiRoutes.js                Endpoint table + API-key middleware
public/
  index.html                  Frontend (slots, booking, confirmation, history)
tests/
  api.test.js                 End-to-end contract tests
```

## Setup

```bash
npm install
cp .env.example .env
# edit .env with your MongoDB URI and API key
npm start
```

Environment variables:

| Variable | Purpose |
| -------- | ------- |
| `PORT` | HTTP port (default `4000`; hosts usually set this) |
| `MONGODB_URI` | MongoDB connection string |
| `API_KEY` | Key required in the `X-API-Key` header |
| `NODE_ENV` | `development` or `production` |

Open <http://localhost:4000> for the web page. The API is mounted at both the
root (`/slots`) and `/api/slots`; the root paths are the ones in the spec.

## API summary

| Method | Path | Success | Notes |
| ------ | ---- | ------- | ----- |
| `POST` | `/reset` | 200 | Replaces slots and deletes all bookings |
| `GET` | `/slots` | 200 | Optional `?provider=` exact filter, sorted by `start` |
| `POST` | `/bookings` | 201 | Optional `Idempotency-Key` header |
| `GET` | `/bookings` | 200 | `?email=` required, `limit` 1-50, `cursor` |
| `GET` | `/bookings/:id` | 200 | 404 when unknown |
| `DELETE` | `/bookings/:id` | 200 | 409 when already cancelled |

`X-API-Key` is required on all of them. Missing or wrong key returns `401`.

Status codes implemented for booking: `400` (missing/invalid fields or slot
already started), `404` (unknown slot), `409` (slot already booked), `422`
(idempotency key reused with a different body), `429` (rate limit, with
`Retry-After` in whole seconds).

## Tests

With MongoDB running and the server started (`npm start`), in another terminal:

```bash
npm test
```

The suite exercises all five levels, including concurrency (10 simultaneous
bookings for one slot) and cursor pagination.

## Deployment (Vercel)

The app is already wired for Vercel:

- `api/index.js` and `api/[...path].js` export the Express app as the handler.
- `server/app.js` only calls `app.listen()` when run directly, not in serverless mode.
- `vercel.json` rewrites the spec's root paths (`/slots`, `/bookings`, ...) to
  the `/api` mount.
- `public/index.html` is served as a static file at `/`.
- Rate limiting is stored in MongoDB, so it is shared across serverless
  instances.

Steps:

```bash
npm i -g vercel
vercel login
vercel --prod
```

Then add the environment variables in the Vercel dashboard (Project → Settings →
Environment Variables) for Production:

| Name | Value |
| ---- | ----- |
| `MONGODB_URI` | Your MongoDB Atlas connection string, including a database name |
| `API_KEY` | The key the page and the checks will send |
| `NODE_ENV` | `production` |

In Atlas, allow access from `0.0.0.0/0` (or Vercel's egress ranges) so the
serverless functions can connect.

For any other Node host (Render, Railway, Fly, Docker), use `npm install` as the
build command and `npm start` as the start command. `render.yaml` and a
`Dockerfile` are included.

**Never upload `.env`** — both `.gitignore` and `.vercelignore` exclude it.

## Security notes

- `.env` is git-ignored; `.env.example` contains no secrets.
- `helmet` sets sensible security headers (CSP disabled only because the demo
  page uses inline styles/scripts).
- The API key is compared in constant time.
- JSON bodies are limited to 100 KB and malformed JSON returns `400`.
- Errors never leak stack traces.
- Rate-limit state is stored in MongoDB, so it works with serverless instances
  and multiple replicas.
- The web page keeps the API key in `localStorage`. For a real product, proxy
  API calls through a small backend so the key is never shipped to browsers.
