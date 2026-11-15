# API Reference — identity-desk

Typed contract for the HTTP surface and the actor RPC surface exposed by `src/index.ts`.

All HTTP responses are `application/json; charset=utf-8`. All phone numbers are E.164 (`+` followed by 10–15 digits, no leading zero). Inputs are normalized with `normalizeE164()` — any non-digit characters are stripped before validation, so `+1 (555) 010-1999`, `15550101999`, and `%2B15550101999` all resolve to the same actor.

---

## Data types

These shapes appear in multiple responses and are defined once here.

### `SnapshotRow`

One row of the append-only `identity_snapshot` table.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `phone_e164` | `string` | no | E.164 number the snapshot belongs to. |
| `looked_up_at` | `string` (ISO-8601 UTC) | no | Lookup timestamp. Part of the dedupe key. |
| `source_type` | `string` | no | Lookup types composed into this snapshot. Always `"carrier+enhanced-caller-name"`. Part of the dedupe key. |
| `carrier_name` | `string` | yes | `carrier.name`, falling back to `portability.normalized_carrier`. |
| `line_type` | `string` | yes | `carrier.type` — e.g. `mobile`, `voip`, `landline`. |
| `ported_status` | `string` | yes | `portability.ported_status` — `"Y"` / `"N"`. |
| `caller_name` | `string` | yes | `enhanced_caller_name.caller_name`, falling back to `caller_identity.caller_name`. |
| `entity_type` | `string` | yes | `enhanced_caller_name.entity_type` — `"person"` or `"business"`. |
| `confidence_score` | `integer` | no | `caller_identity.confidence_score` (50–90 scale). `80` when a name is present without a score, `0` when no name is returned. |

### `Delta`

A computed difference between two consecutive snapshots.

| Field | Type | Description |
|---|---|---|
| `from` | `string` (ISO-8601) | `looked_up_at` of the earlier snapshot. |
| `to` | `string` (ISO-8601) | `looked_up_at` of the later snapshot. |
| `changes` | `string[]` | Zero or more of `carrier_changed`, `name_changed`, `portability_changed`, `line_type_changed`, `voip_low_trust`. |

### `Ledger`

The merged identity record for one number — the staff-facing view.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `phone_e164` | `string` | no | The number this ledger describes. |
| `snapshot_count` | `integer` | no | Number of snapshots filed for this number. |
| `verified` | `boolean` | no | `true` when the latest snapshot has `confidence_score >= 70`. |
| `low_trust` | `boolean` | no | `true` when the latest snapshot's `line_type` is `"voip"`. |
| `latest` | `SnapshotRow` | yes | Most recent snapshot, or `null` if the number has never been looked up. |
| `deltas` | `Delta[]` | no | Pairwise diffs across the snapshot history, oldest first. Empty for a single snapshot. |
| `snapshots` | `SnapshotRow[]` | no | Full history, ordered by `looked_up_at` ascending. |

### `IntakeResult`

| Field | Type | Description |
|---|---|---|
| `status` | `"filed" \| "duplicate"` | `"filed"` when a new snapshot was written; `"duplicate"` when the `(phone_e164, looked_up_at, source_type)` key already existed and no lookup was performed. |
| `phone_e164` | `string` | Normalized E.164 number. |
| `looked_up_at` | `string` (ISO-8601) | Timestamp used for this snapshot. |
| `flags` | `string[]` | Delta flags raised by this filing. Empty on `"duplicate"`. |
| `ledger` | `Ledger` | The full ledger after the filing. |

### `Error`

| Field | Type | Description |
|---|---|---|
| `error` | `string` | Human-readable, non-sensitive message. Internal exception detail is logged server-side only. |

---

## POST /intake

The only path that creates an `IdentityDesk` actor. Resolves the actor via `env.IDENTITY.idFromName(digitsOfE164(e164))`, runs the multi-type Number Lookup, files a snapshot, computes deltas against the previous snapshot, and returns the updated ledger.

If the `(phone_e164, looked_up_at, source_type)` triple already exists, the lookup is skipped entirely and `status: "duplicate"` is returned — redelivery of the same intake event never creates a second row.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `phoneE164` | `string` | **yes** | Caller's number. Normalized to E.164; must yield 10–15 digits and must not start with `0`. |
| `capturedAt` | `string` (ISO-8601) | no | Intake timestamp. Defaults to `new Date().toISOString()` when omitted or unparseable. Doubles as the dedupe key, so replaying the same event with the same `capturedAt` is idempotent. |

### Example request

```bash
curl -s -X POST http://localhost:8787/intake \
  -H 'content-type: application/json' \
  -d '{
    "phoneE164": "+15550101999",
    "capturedAt": "2025-06-02T09:00:05Z"
  }'
```

### Response — `200 OK`

```json
{
  "status": "filed",
  "phone_e164": "+15550101999",
  "looked_up_at": "2025-06-02T09:00:05.000Z",
  "flags": [],
  "ledger": {
    "phone_e164": "+15550101999",
    "snapshot_count": 1,
    "verified": true,
    "low_trust": false,
    "latest": {
      "phone_e164": "+15550101999",
      "looked_up_at": "2025-06-02T09:00:05.000Z",
      "source_type": "carrier+enhanced-caller-name",
      "carrier_name": "Verizon Wireless",
      "line_type": "mobile",
      "ported_status": "N",
      "caller_name": "Martha Reyes",
      "entity_type": "person",
      "confidence_score": 80
    },
    "deltas": [],
    "snapshots": [
      {
        "phone_e164": "+15550101999",
        "looked_up_at": "2025-06-02T09:00:05.000Z",
        "source_type": "carrier+enhanced-caller-name",
        "carrier_name": "Verizon Wireless",
        "line_type": "mobile",
        "ported_status": "N",
        "caller_name": "Martha Reyes",
        "entity_type": "person",
        "confidence_score": 80
      }
    ]
  }
}
```

### Response — `200 OK` (second visit, carrier ported)

```json
{
  "status": "filed",
  "phone_e164": "+15550101999",
  "looked_up_at": "2025-06-04T10:00:05.000Z",
  "flags": ["carrier_changed", "portability_changed"],
  "ledger": {
    "phone_e164": "+15550101999",
    "snapshot_count": 2,
    "verified": true,
    "low_trust": false,
    "latest": {
      "phone_e164": "+15550101999",
      "looked_up_at": "2025-06-04T10:00:05.000Z",
      "source_type": "carrier+enhanced-caller-name",
      "carrier_name": "Google Fi",
      "line_type": "mobile",
      "ported_status": "Y",
      "caller_name": "Martha Reyes",
      "entity_type": "person",
      "confidence_score": 80
    },
    "deltas": [
      {
        "from": "2025-06-02T09:00:05.000Z",
        "to": "2025-06-04T10:00:05.000Z",
        "changes": ["carrier_changed", "portability_changed"]
      }
    ],
    "snapshots": [
      { "phone_e164": "+15550101999", "looked_up_at": "2025-06-02T09:00:05.000Z", "source_type": "carrier+enhanced-caller-name", "carrier_name": "Verizon Wireless", "line_type": "mobile", "ported_status": "N", "caller_name": "Martha Reyes", "entity_type": "person", "confidence_score": 80 },
      { "phone_e164": "+15550101999", "looked_up_at": "2025-06-04T10:00:05.000Z", "source_type": "carrier+enhanced-caller-name", "carrier_name": "Google Fi", "line_type": "mobile", "ported_status": "Y", "caller_name": "Martha Reyes", "entity_type": "person", "confidence_score": 80 }
    ]
  }
}
```

### Response — `200 OK` (redelivered event)

```json
{
  "status": "duplicate",
  "phone_e164": "+15550101999",
  "looked_up_at": "2025-06-04T10:00:05.000Z",
  "flags": [],
  "ledger": { "...": "unchanged, snapshot_count stays 2" }
}
```

### Response — `200 OK` (VoIP number, low trust)

```json
{
  "status": "filed",
  "phone_e164": "+15550101998",
  "looked_up_at": "2025-06-05T11:00:00.000Z",
  "flags": ["voip_low_trust"],
  "ledger": {
    "phone_e164": "+15550101998",
    "snapshot_count": 1,
    "verified": false,
    "low_trust": true,
    "latest": {
      "phone_e164": "+15550101998",
      "looked_up_at": "2025-06-05T11:00:00.000Z",
      "source_type": "carrier+enhanced-caller-name",
      "carrier_name": "Bandwidth.com",
      "line_type": "voip",
      "ported_status": "N",
      "caller_name": null,
      "entity_type": null,
      "confidence_score": 0
    },
    "deltas": [],
    "snapshots": ["..."]
  }
}
```

### Response — `400 Bad Request`

Returned when `phoneE164` is missing, not a string, shorter than 10 digits, longer than 15 digits, or starts with `0`.

```json
{ "error": "phoneE164 must be a valid E.164 number" }
```

### Response — `500 Internal Server Error`

Returned when the lookup fails (non-2xx from `/v2/number_lookup`), `TELNYX_API_KEY` is missing in live mode, or the SQL write fails. The underlying message is logged, never returned.

```json
{ "error": "internal error" }
```

---

## GET /identity/{e164}

The staff surface over HTTP. Equivalent to the `identity(e164)` RPC — returns the merged ledger and deltas without performing a lookup or writing a row. Safe to poll.

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `e164` | `string` | **yes** | URL-encoded phone number. Normalized the same way as `phoneE164`. Use `%2B` for the leading `+`. |

### Example request

```bash
curl -s http://localhost:8787/identity/%2B15550101999
```

### Response — `200 OK`

Returns a `Ledger`. A number that has never been captured returns a well-formed empty ledger rather than a 404:

```json
{
  "phone_e164": "+15550101999",
  "snapshot_count": 0,
  "verified": false,
  "low_trust": false,
  "latest": null,
  "deltas": [],
  "snapshots": []
}
```

Populated ledger shape is identical to the `ledger` object in the `POST /intake` response.

### Response — `400 Bad Request`

Path segment does not normalize to a valid E.164 number.

```json
{ "error": "path must contain a valid E.164 number" }
```

### Response — `500 Internal Server Error`

```json
{ "error": "internal error" }
```

---

## POST /demo/run

Runs the scripted end-to-end demo against the live actor namespace and returns every intermediate result. No request body is read.

The script performs, in order:

1. `onIntakeCaptured` for `+15550101999` at `2025-06-02T09:00:05Z` → snapshot v1 (Verizon Wireless, mobile, `ported_status: "N"`).
2. `onIntakeCaptured` for the same number at `2025-06-04T10:00:05Z` → snapshot v2 (Google Fi, mobile, `ported_status: "Y"`), flags `carrier_changed` + `portability_changed`.
3. Replays step 2 verbatim → `status: "duplicate"`, no third row.
4. `onIntakeCaptured` for `+15550101998` at `2025-06-05T11:00:00Z` → VoIP snapshot, flag `voip_low_trust`.
5. `identity("+15550101999")` → the merged ledger.

### Example request

```bash
curl -s -X POST http://localhost:8787/demo/run
```

### Response — `200 OK`

| Field | Type | Description |
|---|---|---|
| `first` | `IntakeResult` | Snapshot v1 filing. |
| `second` | `IntakeResult` | Snapshot v2 filing with the carrier/portability delta. |
| `replay` | `IntakeResult` | Redelivery of the v2 event; `status` is `"duplicate"`. |
| `voip` | `IntakeResult` | VoIP number filing; `ledger.low_trust` is `true`. |
| `ledger` | `Ledger` | Final merged ledger for `+15550101999` (`snapshot_count: 2`). |

```json
{
  "first":  { "status": "filed", "phone_e164": "+15550101999", "looked_up_at": "2025-06-02T09:00:05.000Z", "flags": [], "ledger": { "...": "..." } },
  "second": { "status": "filed", "phone_e164": "+15550101999", "looked_up_at": "2025-06-04T10:00:05.000Z", "flags": ["carrier_changed", "portability_changed"], "ledger": { "...": "..." } },
  "replay": { "status": "duplicate", "phone_e164": "+15550101999", "looked_up_at": "2025-06-04T10:00:05.000Z", "flags": [], "ledger": { "...": "..." } },
  "voip":   { "status": "filed", "phone_e164": "+15550101998", "looked_up_at": "2025-06-05T11:00:00.000Z", "flags": ["voip_low_trust"], "ledger": { "...": "..." } },
  "ledger": { "phone_e164": "+15550101999", "snapshot_count": 2, "verified": true, "low_trust": false, "latest": { "...": "..." }, "deltas": [{ "from": "2025-06-02T09:00:05.000Z", "to": "2025-06-04T10:00:05.000Z", "changes": ["carrier_changed", "portability_changed"] }], "snapshots": ["...", "..."] }
}
```

### Response — `500 Internal Server Error`

```json
{ "error": "internal error" }
```

---

## Unmatched routes

Any method/path combination not listed above returns `404`.

```json
{ "error": "not found" }
```

---

## Status code summary

| Code | When |
|---|---|
| `200` | Successful intake filing, duplicate detection, ledger read, or demo run. |
| `400` | `phoneE164` (body) or the `/identity/{e164}` path segment does not normalize to a valid E.164 number. |
| `404` | Route not matched. |
| `500` | Lookup failure, missing `TELNYX_API_KEY` in live mode, SQL failure, or malformed JSON body that throws past the `catch`. |

---

## Actor RPC surface

The `IdentityDesk` actor is reachable directly through the `IDENTITY` namespace binding. Both methods are also exposed over HTTP above; the RPC form is what the booking app and the demo script use.

```ts
const id = env.IDENTITY.idFromName(digitsOfE164(e164)); // "15550101999"
const desk = env.IDENTITY.get(id) as unknown as IdentityDeskRpc;
```

### `onIntakeCaptured(payload: IntakePayload): Promise<IntakeResult>`

| Field | Type | Required | Description |
|---|---|---|---|
| `phoneE164` | `string` | **yes** | Caller number; normalized to E.164. Throws `phoneE164 must be a valid E.164 number` when invalid. |
| `capturedAt` | `string` | no | ISO-8601 intake timestamp; defaults to now. Dedupe key component. |

Side effects: creates the actor on first call, runs the multi-type lookup, inserts one `identity_snapshot` row, merges `flags` into actor state, and updates `snapshotCount`, `lastConfidence`, `carrierName`, `lineType`, `entity_type`.

### `identity(e164: string): Promise<Ledger>`

Read-only. Returns the merged ledger for the number. Throws `e164 must be a valid E.164 number` on invalid input. Logs the discovered RPC surface via `rpcSurface(this)` on each call.

```ts
const ledger = await desk.identity("+15550101999");
// ledger.snapshot_count === 2
// ledger.deltas[0].changes === ["carrier_changed", "portability_changed"]
```

---

## Upstream Telnyx call

The actor issues exactly one Telnyx request per non-duplicate intake:

```
GET https://api.telnyx.com/v2/number_lookup/{e164}?type=carrier&type=enhanced-caller-name
Authorization: Bearer <TELNYX_API_KEY>
Accept: application/json
```

Both types are requested in a single call; the response `data` object is mapped by `normalizeLookup()` onto the `SnapshotRow` columns. Fields consumed: `carrier.name`, `carrier.type`, `portability.ported_status`, `portability.normalized_carrier`, `portability.line_type`, `enhanced_caller_name.caller_name`, `enhanced_caller_name.entity_type`, `caller_identity.caller_name`, `caller_identity.confidence_score`.

When `DEMO_MODE` is unset or anything other than `"false"`, no network call is made — `demoLookup()` returns deterministic fixtures (odd last digit → Verizon Wireless then Google Fi on the second lookup; even last digit → Bandwidth.com VoIP).
