# Webhook Aggregator Fanout — Demo Video Script

**Target runtime:** 3:15–3:45
**Pacing:** Conversational, not rushed. Let the UI breathe between beats.
**Setup before recording:** Demo already running at `http://localhost:5555/`. Browser window sized to ~1280px. Clear the DB (delete `demo/demo_events.db` and restart) so the Recent events table starts empty.

---

## [0:00 – 0:25] INTRO (what we built)

> Hey — ever shipped a webhook endpoint and then watched it fall over the first time Telnyx redelivers an event? Or the first time a burst of call and SMS events lands in the same second?
>
> Today I want to show you a small Flask app we just shipped called **Webhook Aggregator with Fanout**. It takes raw Telnyx webhooks and runs them through a six-stage pipeline — receive, verify, dedup, log, fan out, process — so your business logic never sees a duplicate, never sees a tampered event, and never blocks on the network.
>
> Three minutes, live demo, no slides. Let's go.

*[Cut to browser — dashboard at localhost:5555]*

---

## [0:25 – 1:05] USE CASES (who this is for)

> Before I click anything — three real places this pattern earns its keep:
>
> **One: contact center auto-attendant.** A customer calls in, Telnyx fires `call.answered`, the app answers and plays a greeting. Without dedup, a redelivered webhook answers the same call twice — which either errors out or plays audio over itself. The TTL KV store kills that.
>
> **Two: two-way SMS autoresponder.** Inbound SMS arrives, you send a reply. Telnyx retries delivery if your server is slow — so the same `message.received` can land three times in five minutes. You want exactly one reply going out, not three.
>
> **Three: audit and observability for comms.** Every event hits SQLite before any action fires. So when something goes weird at 3am, you have a real table — `event_id`, `event_type`, `payload`, `received_at` — not just logs you have to grep.

*[Pause ~1 second. Hand moves to mouse.]*

---

## [1:05 – 1:25] TECH STACK (10 seconds, don't dwell)

> Stack is deliberately boring: **Flask 3** for the HTTP layer, **SQLite** for the event log, an **in-memory TTL KV store** for dedup, **PyNaCl** for Ed25519 signature verification, and the **Telnyx Python SDK v4** for the actual call and SMS actions. No Redis, no Celery, no message broker — the whole thing fits in one file.

---

## [1:25 – 2:50] WEB APP WALKTHROUGH (the meat)

### [1:25] Send call webhook

> Okay — dashboard. The six stages up top are the pipeline. Right now everything's idle.
>
> I click **Send call webhook**.

*[Click "Send call webhook". Pipeline lights up: receive → verify → dedup → log → fanout → process, one stage at a time, all green. An event appears in the Recent events table.]*

> Watch the stepper — receive, verify the Ed25519 signature, dedup check, log to SQLite, fan out to the call queue, the worker picks it up and answers the call. All six stages, milliseconds. The event's now in the table: `call.answered`, timestamp, event ID.
>
> On the right — call queue drained to zero because the worker consumes instantly. Total logged: one.

### [1:55] Send SMS webhook

> Now **Send SMS webhook**.

*[Click "Send SMS webhook". Same pipeline animation. New row appears: `message.received`.]*

> Same six stages. But notice the fanout stage routed it to the **SMS queue**, not the call queue — that's the fanout doing its job. Event type determines the queue. Worker picks it up, sends the auto-reply. Two events in the log now.

### [2:15] Send duplicate (the punchline)

> Here's the one I want you to see. **Send duplicate**. This replays the exact same event ID we just sent.

*[Click "Send duplicate". Pipeline lights receive → verify → dedup, then STOPS at dedup. Notice turns orange: "Duplicate detected — rejected by the dedup layer."]*

> Look at the stepper — it stops at **dedup**. The TTL KV store already has that event ID from a few seconds ago, so it short-circuits. No SQLite insert, no fanout, no duplicate SMS sent to a real customer.
>
> And the event count on the right — still two. Not three. That's the whole point.

### [2:40] Quick glance at the side panels

> Health endpoint says healthy. Both queues at zero — workers drain instantly in the demo. In production you'd see real depth here when a burst hits.

---

## [2:50 – 3:25] OUTRO

> So that's the **Webhook Aggregator with Fanout**. Six stages, one file, no infrastructure beyond Flask and SQLite. It's production-shaped — Ed25519 verification, idempotency, persistent audit log, and clean fanout to typed action queues — but small enough to read in an afternoon.
>
> The repo is `telnyx-code-examples/webhook-aggregator-fanout` on GitHub. The demo launcher you just saw is in the `demo/` folder — `python demo_server.py`, open localhost:5555, you're running it.
>
> If you build comms workflows on Telnyx, this pattern is the foundation I'd start from. Links in the description. Thanks for watching.

---

## Recording checklist

- [ ] Delete `demo/demo_events.db` and restart `demo_server.py` so the table starts empty
- [ ] Browser window ~1280px wide (responsive grid looks right at this width)
- [ ] Zoom level 100% — the stepper dots and event table need to be readable
- [ ] Clear browser cache / hard reload so no stale state
- [ ] Quiet room — the only audio is your voice
- [ ] One take if possible; the flow is linear and the timings are forgiving

## If you want a tighter 3:00 cut

Drop the tech stack section (1:05–1:25). Everything else still lands. The use cases + live demo + outro fit cleanly in 2:50.
