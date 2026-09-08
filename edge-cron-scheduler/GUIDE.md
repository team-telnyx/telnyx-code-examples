# Edge Cron Scheduler walkthrough

## Start locally

Use Node.js 22.13+. Run `npm ci`, copy `.env.example` to `.env`, and run `npm start`. Keep `DEMO_MODE=true` while verifying the workflow. The server listens on loopback and prints a temporary token if you did not configure one. Put that token in `SCHEDULER_TOKEN` in your terminal for the commands below.

The local server runs the actual `CronAgent` class and SDK timer dispatcher. Its SQLite adapter stores KV, SDK task records and execution SQL on disk. Edge deployment replaces that development host with the platform's actor context; the application code stays the same.

## Create all three job types

```bash
curl -s http://127.0.0.1:8787/jobs -H "Authorization: Bearer $SCHEDULER_TOKEN" -H 'Content-Type: application/json' -d '{"id":"call","name":"Scheduled call","cron":"* * * * *","type":"call","target":"+18005550102"}'
curl -s http://127.0.0.1:8787/jobs -H "Authorization: Bearer $SCHEDULER_TOKEN" -H 'Content-Type: application/json' -d '{"id":"sms","name":"Scheduled SMS","cron":"* * * * *","type":"sms","target":"+18005550102","payload":{"text":"Scheduled check"}}'
curl -s http://127.0.0.1:8787/jobs -H "Authorization: Bearer $SCHEDULER_TOKEN" -H 'Content-Type: application/json' -d '{"id":"webhook","name":"Scheduled webhook","cron":"* * * * *","type":"webhook","target":"https://example.com/events","payload":{"message":"ping"}}'
```

Wait up to 60 seconds after the next matching minute, then read `/logs` with the same bearer header. Expect three `success` rows with `simulated_call`, `simulated_sms` and `simulated_webhook` results. Wait another minute and confirm separate rows with distinct run IDs. `/jobs` shows the advanced `nextRun` values.

For a quick check, `POST /jobs/sms/run` queues a manual occurrence immediately without moving the recurring deadline. Its response is an acceptance receipt; poll logs for completion.

## Failure and dependency flow

Create a webhook job with `demoFailure:true` and cron `* * * * *`. It will record `failure` and `notification:simulated`. Create a second job with the same cron and `dependsOn:["the-failing-job-id"]`. At a shared scheduled occurrence it will record `skipped`. Parents must exist before dependents are created, making dependency cycles impossible through the create-only API.

Dependencies check the matching scheduled timestamp, not a success from a previous day. Changing a schedule requires deleting dependents first, then the parent, and recreating the definitions.

## Restart check

Stop the local server and run `npm start` again. Reuse the bearer token from `.env`, or use the new temporary token. Jobs and logs remain in `.data/scheduler.sqlite`; the SDK re-arms saved timers. Each overdue job gets one execution, then advances to its next future time. Missed intermediate occurrences are skipped.

## Live configuration

Set real sender, connection and notification numbers and `TELNYX_API_KEY` in the local environment. For webhooks, list trusted exact hostnames in `WEBHOOK_HOSTS`. Set `DEMO_MODE=false` and restart only when ready to send real requests.

On Edge, declare the actor and Telnyx binding using the supplied `telnyx.toml`, provision `SCHEDULER_TOKEN`, and configure the communications binding through the CLI/account. Consult `telnyx-edge ship --help` for your installed CLI. Authenticate to `/health` once after deployment to initialize the poller; creating a job also initializes it.

A successful result is an accepted outbound request. Final SMS delivery and call lifecycle tracking would require a separate signed webhook integration. Automatic resending is deliberately disabled after an execution claim to avoid duplicated communications when a process crashes or an API response is lost. Inspect uncertain `running` rows before retrying. Failure notifications are best effort and their outcome is recorded separately.

## Verification

`npm test` compiles the project and exercises the real SDK against SQLite: cron boundaries, timer dispatch, repeated SQL rows, dependency outcomes, restart recovery, duplicate suppression, SDK request shape and HTTP behavior. External calls are mocked or simulated. `npm run typecheck` checks application, local host and tests together.
