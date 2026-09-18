---
name: edge-cron-scheduler
title: Edge Cron Scheduler with Telnyx SMS Notifications
description: A durable UTC cron scheduler with actor KV, SQL execution history, and Telnyx SMS failure alerts.
language: typescript
framework: edge
telnyx_products: [SMS, Messaging, Agent SDK, KV, SQL]
---

# Edge Cron Scheduler

Schedule calls, SMS messages and HTTPS webhooks with five-field UTC cron expressions, durable tasks, execution history and failure alerts.

## Why Telnyx

Telnyx AI Communications Infrastructure combines stateful agents and communications APIs. This sample uses the published `@telnyx/edge-runtime` Agent SDK to persist recurring timers and queued work, actor KV to store job definitions, and actor SQL to retain a separate record for each execution.

## Telnyx API Endpoints Used

| API | Purpose |
| --- | --- |
| `Agent.every(60, 'poll')` | Durable polling every 60 seconds |
| `Agent.queue('execute', task)` | Durable execution dispatch |
| `ctx.storage.get/put('jobs')` | Per-actor KV job registry |
| `ctx.storage.sql.exec(...)` | Embedded SQL execution history |
| `TELNYX.calls.dial(...)` / `POST /v2/calls` | Request an outbound call |
| `TELNYX.messages.send(...)` / `POST /v2/messages` | Send a message or failure alert |

## Architecture

```text
Authenticated HTTP request → one CronAgent named "scheduler"
                                 │
                            actor KV registry
                                 │
                         every(60, 'poll')
                                 │
                       queue('execute', task)
                                 │
                 SQL execution claim → call / SMS / webhook
                                 │
                   SQL outcome → failure SMS if necessary
```

The production runtime owns actor activation and alarms. `local/server.ts` provides a single-process development host using the same Agent SDK with a disk-backed SQLite storage adapter. It serializes HTTP/alarm turns and resumes saved timers on restart. It does not emulate a distributed Edge deployment.

## Environment Variables

| Variable | Default / purpose |
| --- | --- |
| `DEMO_MODE` | `true`; only the exact value `false` enables external requests |
| `PORT` | `8787`, local server only |
| `SCHEDULER_TOKEN` | Bearer token for every route except `/` and `/health/liveness`; generated temporarily by the local server if empty |
| `SCHEDULER_DB` | `.data/scheduler.sqlite`, local persistent state |
| `TELNYX_API_KEY` | Local live-mode SDK credential; unused in demo mode |
| `TELNYX_PHONE_NUMBER` | Sender number for live calls, SMS and alerts |
| `TELNYX_CONNECTION_ID` | Call Control connection ID for live calls |
| `NOTIFICATION_PHONE_NUMBER` | Destination for live failure alerts |
| `WEBHOOK_HOSTS` | Comma-separated exact HTTPS hostnames allowed for live webhooks; redirects rejected |

> **Agent / CLI access:** Use `telnyx --help` to inspect account provisioning commands and obtain an SMS-capable sender and a Call Control connection. Production uses the Edge `TELNYX` binding; the local server constructs the SDK from `TELNYX_API_KEY`.

## Setup

Requires Node.js 22.13+ and npm. No account credentials or Docker are needed for the local simulation.

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/edge-cron-scheduler
npm ci
cp .env.example .env
npm start
```

<details><summary>Programmatic / CLI setup</summary>

For the Telnyx Edge configuration, inspect your installed CLI's account, binding and secret commands before deployment:

```bash
telnyx-edge status
telnyx-edge bindings --help
telnyx-edge secrets --help
telnyx-edge ship --help
```

`telnyx.toml` declares the `CRON_AGENT` actor, `TELNYX` communications binding and `SCHEDULER_TOKEN` secret. Configure the token and communications binding in the target account before shipping. Keep `DEMO_MODE=true` for an initial deployed check. Call authenticated `GET /health` or create a job to initialize the durable poller.

</details>

Open the **dashboard URL** printed by `npm start`. When the server generates a temporary token, its URL fragment connects this browser tab, then disappears from the address bar. If you configure `SCHEDULER_TOKEN`, paste it into the connection form; the server does not print that credential. The token is kept only in that tab's session storage; Disconnect clears it. You can also visit `/` and paste the token into the connection form.

For a short recording: click **Load demo jobs**, enable **Recording view**, click **Run all**, and then **Try a failure**. The cards, counters and history update from the real scheduler API. The countdown shows the next actual polling deadline. Use **Create job** for a custom call, SMS or webhook schedule, and **Details** to inspect a saved execution. The visible mode label distinguishes simulated communications from live sending. The recording uses the local server.

Copy the generated temporary token from the local startup output, or set `SCHEDULER_TOKEN` in `.env` before starting. In another terminal:

```bash
export SCHEDULER_TOKEN='paste-your-local-token'
curl -s http://127.0.0.1:8787/health -H "Authorization: Bearer $SCHEDULER_TOKEN"
curl -s http://127.0.0.1:8787/jobs \
  -H "Authorization: Bearer $SCHEDULER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":"sms-check","name":"SMS check","cron":"* * * * *","type":"sms","target":"+18005550102","payload":{"text":"Scheduled check"}}'
curl -s -X POST http://127.0.0.1:8787/jobs/sms-check/run -H "Authorization: Bearer $SCHEDULER_TOKEN"
curl -s http://127.0.0.1:8787/logs -H "Authorization: Bearer $SCHEDULER_TOKEN"
```

The run endpoint returns `202` with a `runId`; poll `/logs` until that row appears. Automatic execution starts at the next matching UTC minute and may be up to one polling interval late. The registry and logs survive restarting `npm start`.

Run checks with `npm test` and `npm run typecheck`. Against an already-running demo server, run `SCHEDULER_TOKEN=your-token npm run test:http` to verify two automatic occurrences of all three job types (about two minutes). Set `SCHEDULER_URL` to target a different port.

## Scheduling and delivery semantics

- Five fields: minute, hour, day of month, month, day of week. `0 9 * * *` means 09:00 UTC; `*/5 * * * *` means every fifth clock minute. Seconds and timezone overrides are not accepted.
- Jobs are created with their first matching future time. No immediate execution unless `/run` is requested. Job IDs are immutable; delete and recreate to change a definition.
- After downtime, each overdue job runs once for its oldest pending slot; missed intermediate slots are skipped. There is no catch-up burst.
- `dependsOn` names existing jobs with the same cron expression. A scheduled dependent requires success in the same slot; a failed dependency produces a `skipped` execution. Delete dependents before their parents. Manual runs are available only for jobs without dependencies.
- A stable run ID and SQL claim suppress repeated task delivery. The application does **not** promise exactly-once external effects: a crash after recording `running` leaves an uncertain row and will not automatically resend it. Inspect that run before manually retrying. Network errors can also represent an accepted request whose response was lost.
- `success` means the API accepted the request, not that a call connected or an SMS was delivered. This sample does not receive delivery webhooks.
- Failure alerts are attempted once and recorded as `sent`, `failed` or `simulated`. A crash between the outcome write and alert may omit the alert; there is no alert retry service.
- Demo mode simulates all three external actions, while timers, KV and SQL remain real. Set `demoFailure:true` on a demo job to exercise failure handling. In live mode this flag has no effect.

## API Reference

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-cron-scheduler/API.md) and the [walkthrough](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-cron-scheduler/GUIDE.md).

## Troubleshooting

| Symptom | Action |
| --- | --- |
| 401 | Supply the configured bearer token; a generated local token changes on restart |
| 503 | Configure `SCHEDULER_TOKEN` in the Edge environment |
| Job has not run yet | Check UTC `nextRun` and allow one 60-second polling interval |
| Live webhook fails | Add the exact hostname to `WEBHOOK_HOSTS`; ensure HTTPS and no redirects |
| Alert says `failed` | Check sender, notification number and Telnyx credentials |
| Execution remains `running` after a crash | Treat its external outcome as uncertain; investigate before creating a manual retry |
| Node cannot import `node:sqlite` | Use Node.js 22.13+ |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx Agent CLI](https://github.com/team-telnyx/ai)
- [Agent Skills](https://github.com/team-telnyx/telnyx-skills)
- [Full documentation](https://developers.telnyx.com/llms-full.txt)
- [Documentation index](https://developers.telnyx.com/llms.txt)
- [Telnyx CLI](https://github.com/team-telnyx/telnyx-cli)

## Related Examples

- [Agent Fleet Shared Workspace](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-fleet-shared-workspace/README.md)
- [KV-Backed Rate Limiter](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/kv-backed-rate-limiter/README.md)

## Resources

- [Developer guides](https://developers.telnyx.com/docs/overview)
- [Messaging API](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Node SDK](https://github.com/team-telnyx/telnyx-node)
- [Agent SDK](https://telnyx.com/products/agentsdk)
- [SMS pricing](https://telnyx.com/pricing/messaging)
