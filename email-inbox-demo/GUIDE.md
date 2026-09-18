# Implementation Guide — Email Inbox Demo

A walkthrough of every file in the project, the design decisions behind it, and the gotchas worth knowing about. For the auto-generated agent-discovery summary, see `README.md`.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 22.13+ | Matches the rest of the `telnyx-code-examples` repo |
| Web server | Express 4 | Minimal, no Edge Compute complexity — pure HTTP dashboard |
| Persistence | better-sqlite3 11 | Synchronous, embedded, no migrations framework needed |
| Telnyx SDK | `telnyx` Node v7.20+ | Official SDK; covers Email API |
| Webhook crypto | `tweetnacl` 1.0.3 | Ed25519 verify; smaller surface than libsodium |
| Frontend | Vanilla HTML/CSS/JS in a TypeScript template string | Zero build step, self-contained, matches the `omni-channel-lab-inbox-agent` admin UI pattern |

## File map

```
email-inbox-demo/
├── package.json              # type: module, scripts, deps
├── tsconfig.json             # ES2022, NodeNext, strict
├── .env.example              # all config knobs with defaults
├── .gitignore
├── README.md                 # user-facing entry point
├── PRD.md                    # product spec (TRUST-286)
├── DEMO.md                   # narration script for the YouTube recording
├── API.md                    # endpoint reference
├── GUIDE.md                  # this file — implementation walkthrough
├── src/
│   ├── types.ts              # row types + Telnyx payload shape
│   ├── db.ts                 # better-sqlite3 cache + migrations
│   ├── telnyxClient.ts       # `telnyx` SDK wrappers + payload mapper
│   ├── webhookVerify.ts      # Ed25519 verification (tweetnacl)
│   ├── demoSeeder.ts         # background fake-inbound generator
│   ├── dashboard.ts          # 3-pane HTML export (single self-contained file)
│   └── server.ts             # Express wiring + SSE bus
└── tests/
    └── smoke.test.ts         # 5 smoke tests
```

## Design decisions

### 1. DEMO_MODE is the default — and the first-run experience

The README's quickstart is `npm install && npm start`. No `.env` editing, no Telnyx account, no ngrok. On first launch the server creates a demo inbox (`support@telnyx-demo.msgtelnyx.com`) and the seeder starts firing realistic inbound every 15s.

This means the YouTube demo works out-of-the-box and any developer cloning the repo has a working demo in under a minute. The "trigger inbound" button gives them deterministic control when they want it.

The seeder synthesizes the exact `email.received` payload shape Telnyx would send, then routes it through the same storage + SSE pipeline as a real webhook. Switching to live mode is just a config flip.

### 2. The dashboard is one self-contained HTML file

`src/dashboard.ts` exports a single function `dashboard(opts)` that returns a complete HTML document as a string. The server serves it from `GET /`. The page uses inline CSS and inline JS — no separate asset files, no build step, no framework.

This is the same pattern as `omni-channel-lab-inbox-agent/src/adminHtml.ts` and keeps the project portable: anyone can open the dashboard in a browser and inspect it.

### 3. SSE for live updates, not WebSocket

A monitoring feed is one-way push — server to browser. SSE runs over plain HTTP, works through every proxy without configuration, and the browser's `EventSource` reconnects automatically. No need for WebSocket's bidirectional complexity.

Three event types on the bus:
- `inbox_created` — a new inbox appeared
- `message_received` — new email arrived (triggered dashboard refresh + unread badge update)
- `message_status` — read/archive/delete flipped (triggered dashboard refresh)

### 4. `body.recording` CSS class for the YouTube-friendly view

A single class flip on `<body>` makes the demo presentable on screen:
- Type enlarges (15px → 16px body, 13px → 15px inbox rows)
- Debug controls hide (`#trigger-btn`, the "+ Add inbox" form)
- A neutral banner appears explaining the recording view

Toggle button is the top-right "Recording view" / "Exit recording view" link.

### 5. Ed25519 verification uses `tweetnacl`

The Telnyx CLI returns the public key in raw base64 form. We accept three forms:
- Raw base64 (32 bytes) — the Telnyx CLI default
- Raw hex (64 chars) — common in some tools
- PEM-encoded `-----BEGIN PUBLIC KEY-----` — for users who converted it

We use `nacl.sign.detached.verify(message, signature, publicKey)` over the message bytes `<timestamp>.<rawBody>`. The timestamp tolerance is ±300s (5 min) by default.

In `DEMO_MODE=true`, signature verification is bypassed so the manual trigger and unsigned local tests work. In `DEMO_MODE=false`, an unsigned or tampered webhook returns 401.

### 6. Raw body capture on the webhook route

Express's body-parsing middleware consumes the request body — but Ed25519 verification requires the **exact bytes** Telnyx sent, not a re-serialized JSON object. So:

- We do NOT register `app.use(express.json())` globally
- The webhook route uses `express.raw({ type: "*/*", limit: "2mb" })` to capture bytes
- Other routes that need a parsed JSON body register `express.json()` locally

This is the only non-obvious middleware ordering in the project. The PRD's troubleshooting section calls it out.

### 7. SQLite for the local cache

`better-sqlite3` is synchronous, embedded, and has zero migrations framework overhead. The schema is three tables (`inboxes`, `messages`, `events`) created idempotently on first run via `CREATE TABLE IF NOT EXISTS`. No drizzle, no prisma, no knex.

The `events` table is a per-message timeline (queued → received → read → archived) that's currently just appended to but ready for the v2 follow-on that renders delivery chips in the UI.

### 8. The dashboard SSE client reconnects on error

`EventSource.onerror` triggers a `setTimeout(connectSSE, 2000)` reconnect. This handles transient network blips, server restarts, and SSE connection drops without crashing the dashboard. There's no exponential backoff — for a local demo the simplicity is worth more than the resilience.

## Gotchas

### Express body parsing order

If `app.use(express.json())` runs before the webhook route, the raw body is already consumed and `req.body` is a parsed object, not a Buffer. `Buffer.isBuffer(req.body)` will be `false` and verification will silently always pass — but `payload.data.payload.inbox_id` will be undefined because the JSON wasn't reparsed.

**Fix**: don't register global JSON parsing. Use per-route `express.json()` where needed.

### The dashboard's SSE consumer can race with creation

When the user creates an inbox via `POST /api/inboxes`, the server broadcasts `inbox_created` AND returns the new row in the HTTP response. The dashboard's submit handler reloads the inbox list from the API — but it also has an `inbox_created` listener. If the SSE message arrives first, the dashboard re-renders; if the HTTP response arrives first, the same thing happens. Either order works.

### `tweetnacl`'s public key vs Node's crypto

`tweetnacl` takes raw 32-byte keys, not the PEM-wrapped X.509 SubjectPublicKeyInfo format. PEM blocks must be stripped to the base64 body, decoded to raw bytes, and verified as 32 bytes exactly. The Telnyx CLI returns the raw base64 form which is what `nacl.sign.keyPair.fromSecretKey` and friends accept.

### The `received_at` field is set in three places

The `messages.received_at` column needs a Unix-ms timestamp. The seeder and the webhook handler both set it explicitly because `payloadToMessageFields` doesn't return it (it's not in the Telnyx payload — we use `Date.now()` at insertion time instead).

### DEMO seeder's `queueMicrotask`

The seeder calls `queueMicrotask(() => this.tick())` once on `start()` so the dashboard isn't empty on first load even if the interval hasn't fired. The interval is `unref()`'d so it doesn't keep the process alive if the server stops cleanly.

## Why not Edge Compute?

`omni-channel-lab-inbox-agent` runs on Telnyx Edge Compute (Agent SDK + Stateful Actor). This demo doesn't, because:

1. The scope is narrower — no per-customer actor state, no cross-channel inbox, no AI assistant
2. A local Express server is faster to run, easier to inspect, and doesn't require `telnyx-edge ship` to redeploy during dev
3. The dashboard uses Server-Sent Events, which is simpler to set up against a long-running HTTP server than against Edge Compute's request/response model

For a single-channel focused inbox demo, local Express is the right tool.

## What goes where in a v2 follow-on

| v2 | Where |
|---|---|
| Attachments download | `GET /api/messages/:id/attachments/:attachmentId` → proxy to Telnyx Storage with a fresh signed URL |
| Reply | `POST /api/messages/:id/reply` → calls `POST /v2/email_messages` with `In-Reply-To` / `References` |
| Threading | Group `messages` by `thread_id` in the dashboard's left pane |
| Delivery events | Extend the webhook registration + `events` table to track `email.delivered`, `email.opened`, `email.clicked` |
| Operator auth | Replace the unauthenticated API surface with bearer-token middleware (or pass the dashboard through the local Edge Compute runner's existing pattern) |

## How to extend

To add a new endpoint:

1. Add a handler to `src/server.ts` with explicit `express.json()` or `express.raw()` middleware where needed
2. If it changes UI state, call `broadcast(eventName, data)` so connected dashboards update live
3. If it changes persistent state, use the `InboxDb` methods — never call the DB directly

To add a new dashboard panel:

1. Edit `src/dashboard.ts` — add a `<section class="pane">` in `.layout`
2. Add a route in `src/server.ts` that returns the data
3. Add a `fetchJson` call in the inline JS that renders the panel
4. Test in DEMO_MODE first (no credentials), then live mode
