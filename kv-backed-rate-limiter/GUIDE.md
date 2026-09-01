# Guide — KV-Backed Rate Limiter

A distributed, fixed-window rate limiter on Telnyx Edge Compute. Counters
live in KV (so they survive eviction and are consistent across invocations),
decisions are made by a durable per-key `RateLimitAgent` actor, and your ops
phone gets an SMS when rejections spike.

## What you'll build

- `POST /check` — allow/reject decisions with `remaining` budget
- Per-key durable actors (`RateLimitAgent`) + a global registry
- Fixed windows in KV (`RATE_KV`), configurable limit/window
- SMS alerting after `ALERT_THRESHOLD` rejections in a window

## How it works

```
POST /check {key}
  → env.RATE_AGENT.idFromName(key).check()
      → read + increment KV counter for the current window
      → allowed = count <= limit
      → on reject: rejectionCount++; if >= ALERT_THRESHOLD
          queue(alert) — this.env.TELNYX.messages.send(...) to ops
```

The actor is single-threaded per key, so concurrent checks on the same key
serialize — no check-then-set races. Different keys run on different actors in
parallel.

## Run

```bash
npm install
npm run local:dev
```

## Deploy

```bash
telnyx-edge new-func --actor --name=kv-backed-rate-limiter
# merge telnyx.toml bindings (RATE_AGENT + REGISTRY actors, RATE_KV, func_id)
telnyx-edge types
telnyx-edge ship
```

## Try it

```bash
# burn the default budget (RATE_LIMIT=10)
for i in $(seq 1 12); do
  curl -s -X POST https://<your-function>.telnyxcompute.com/check \
    -H "Content-Type: application/json" \
    -d '{"key": "user_123"}' | head -c 120; echo
done

# watch the counters and reset
curl https://<your-function>.telnyxcompute.com/count/user_123
curl -X POST https://<your-function>.telnyxcompute.com/reset/user_123
```

After `ALERT_THRESHOLD` rejections, the ops phone (`ALERT_PHONE`) gets an SMS
sent via the `TELNYX` binding.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Everything allowed | KV binding missing — counters don't persist | Check `[storage.kv.RATE_KV]` id in `telnyx.toml` |
| No alert SMS | `ALERT_PHONE`/`SENDER_PHONE` unset or threshold not hit | Set `[env_vars]`, redeploy |
| Limits don't match config | Stale deploy | `telnyx-edge ship` after changing `[env_vars]` |

## Resources

- [Edge Compute quickstart](https://developers.telnyx.com/docs/edge-compute/quickstart)
- [Telnyx API binding](https://developers.telnyx.com/docs/edge-compute/telnyx-api)
- [Telnyx pricing](https://telnyx.com/pricing)
