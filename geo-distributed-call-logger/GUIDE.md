# Guide — Geo-Distributed Call Logger

Call logging that follows your users around the world. Each inbound call is
mapped to a region from its E.164 country code, recorded by that region's
StatefulActor, and aggregated into a global registry — so you can see the
geo distribution of your call traffic at a glance.

## What you'll build

- Region detection from E.164 numbers (country-code prefix map)
- One durable `GeoLoggerAgent` actor per region + one global `CallRegistry`
- Per-region counters in KV with alert thresholds
- REST views: `/regions/stats`, `/calls`, per-call status
- Telnyx Call Control webhook ingestion (`POST /webhooks/voice`)

## How it works

```
Call event (webhook or /simulate)
  → detectRegion(from)          // "44…" → eu-west-1, "81…" → ap-northeast-1
  → env.GEO_LOGGER.idFromName(region).record(call)
  → env.REGISTRY.idFromName("global").index(call)
  → KV counter per region; SMS alert when a region crosses REGION_THRESHOLD
```

Both actors are durable: counters survive restarts, and each region's actor is
single-threaded so counters never race. The webhook handler verifies the
Telnyx Ed25519 signature before touching state.

## Run

```bash
npm install
npm run local:dev
```

## Deploy

```bash
telnyx-edge new-func --actor --name=geo-distributed-call-logger
# merge telnyx.toml bindings (GEO_LOGGER + REGISTRY actors, REGION_KV, func_id)
telnyx-edge types
telnyx-edge ship
```

Point a Call Control webhook at `https://<your-function>.telnyxcompute.com/webhooks/voice`.

## Try it

```bash
# simulate calls from different regions
curl -X POST https://<your-function>.telnyxcompute.com/simulate \
  -H "Content-Type: application/json" \
  -d '{"from": "+447700900000"}'
curl -X POST https://<your-function>.telnyxcompute.com/simulate \
  -H "Content-Type: application/json" \
  -d '{"from": "+819012345678"}'

# geo distribution
curl https://<your-function>.telnyxcompute.com/regions/stats
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Region `unknown` | Country code not in the map | Extend `COUNTRY_TO_REGION` in `src/geoLogger.ts` |
| Webhook 4xx | Signature verification failed | Ensure `TELNYX_PUBLIC_KEY` secret is set (`telnyx-edge secrets add`) |
| Counters reset | KV binding missing | Check `[storage.kv.REGION_KV]` id in `telnyx.toml` |

## Resources

- [Edge Compute quickstart](https://developers.telnyx.com/docs/edge-compute/quickstart)
- [Call Control webhooks](https://developers.telnyx.com/docs/voice/programmable-voice)
- [Telnyx pricing](https://telnyx.com/pricing)
