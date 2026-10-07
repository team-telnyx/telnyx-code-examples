# API Reference — Clinic Triage & Warm Handoff

HTTP endpoints exposed by the `clinic-triage-handoff` Edge function. All
endpoints run inside one Telnyx Edge Compute worker; the `TriageRouterV3`
actor is provisioned per inbound line via
`env.TRIAGE_ROUTER_V3.idFromName(lineE164)`.

The verified architecture routes each inbound phone line to its own Telnyx
AI Assistant persona (receptionist on the main clinic line, billing desk,
clinical desk). The receptionist uses the native `transfer` tool with
DTMF warm-transfer acceptance; the specialist desks fire a `flag_misroute`
webhook tool to re-route a misrouted caller mid-call. The `TriageRouterV3`
actor owns the per-caller routing log so return callers are recognized on
their next ring via `dynamic_variables.routing_history`.

See [README.md](./README.md) for the high-level architecture and
[GUIDE.md](./GUIDE.md) for the step-by-step walkthrough.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/webhooks/voice` | Inbound Call Control webhook receiver. |
| `POST` | `/log` | Append a row to the actor's routing log from an assistant. |
| `POST` | `/misroute` | Specialist desk `flag_misroute` tool target — stash summary + warm-transfer caller. |
| `GET` | `/` | Telnyx-branded HTML status page with the live routing table. |
| `GET` | `/healthz` | Liveness probe. |

---

### 1. `POST /webhooks/voice`

Receives every Telnyx Call Control event. The handler branches on
`data.event_type`.

| Event | Behavior |
|---|---|
| `call.initiated` | Looks up the line in `ASSISTANT_ROUTES`, injects `routing_history` + `misroute_context` as dynamic variables, answers with that assistant. |
| `call.answered` | Caller leg: greets + `gather_using_ai`. Specialist leg (`client_state.role == "next_agent"`): `gather_using_speak` briefing with DTMF accept/decline. |
| `call.ai_gather.ended` | Classifies the utterance, writes a `routing` row, speaks the hold message, dials the specialist leg with `client_state`. |
| `call.gather.ended` | Specialist DTMF: `1` joins both legs into a conference; `2` hangs up the specialist leg and speaks the fallback. |
| `call.hangup` | Acknowledges. |
| `call.speak.failed` | Logs and ignores. |

Telnyx signature verification is enforced by the Edge runtime; the handler
reads from `data.payload` and never trusts raw webhook bodies for fields
beyond `client_state` (which is base64-JSON from the Edge runtime itself).

---

### 2. `POST /log`

Insert a row into the actor's routing log. Useful when an assistant wants
to record a downstream action against the caller's history (for example,
the billing desk confirming a payment plan). The row appears on the
`GET /` status page and becomes the next caller's
`dynamic_variables.routing_history` on their next inbound call.

The handler accepts either a JSON body or the equivalent query parameters;
query parameters win only when their fields are non-empty.

**Request — JSON body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `caller` | string | yes | Caller's E.164 phone number. |
| `intent` | string | yes | Short intent tag (`billing`, `clinical`, `afterhours`, or any custom label). |
| `note` | string | no | Free-form note about the action. |

**Request — Query parameters (equivalent):**

| Param | Equivalent field |
|---|---|
| `caller` | `caller` |
| `intent` | `intent` |
| `note` | `note` |

**Response — `200 OK`:**

```json
{ "ok": true, "logged": "billing" }
```

**Example — JSON:**

```bash
curl -X POST "https://<edge-endpoint>/log" \
  -H "Content-Type: application/json" \
  -d '{"caller":"+15550001234","intent":"billing","note":"payment plan confirmed"}'
```

**Example — Query params:**

```bash
curl -X POST "https://<edge-endpoint>/log?caller=%2B15550001234&intent=billing&note=payment+plan+confirmed"
```

---

### 3. `POST /misroute`

Webhook target for the specialist desks' `flag_misroute` tool. The handler:

1. Stashes the misroute summary in `misroute_pending` keyed by the desk's
   line (and `caller`, so the lookup is robust whichever side keys first).
2. If `call_control_id` is supplied **and** `desk_line` is in
   `MISROUTE_TARGETS_JSON`, warm-transfers the caller's existing leg to
   the correct desk's line via `POST /v2/calls/{id}/actions/transfer`.
3. When that caller next hits the receiving desk's `call.initiated`, the
   summary is injected as `dynamic_variables.misroute_context` (and then
   cleared from `misroute_pending`).

The handler accepts either a JSON body or the equivalent query parameters;
identifiers also arrive as Telnyx AI Assistant `dynamic_variables` in the
query string.

**Request — JSON body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `desk_line` | string | yes | The desk that flagged the misroute (E.164). |
| `caller` | string | yes | Caller's E.164 phone number. |
| `summary` | string | no | One-line reason the caller was misrouted (shown to the receiving desk). |
| `call_control_id` | string | yes (for transfer) | Caller leg's control ID. If present and `desk_line` is in `MISROUTE_TARGETS_JSON`, the leg is transferred. |

**Request — Query parameters (equivalent):**

| Param | Equivalent field | Notes |
|---|---|---|
| `desk` | `desk_line` | |
| `caller` | `caller` | |
| `ccid` | `call_control_id` | |
| `summary` | `summary` | |

**Response — `200 OK`:**

```json
{ "ok": true, "rerouted_to": "+15550000003" }
```

`rerouted_to` is `null` when either `desk_line` is missing from
`MISROUTE_TARGETS_JSON` or no `call_control_id` was supplied — in both
cases the summary is still stashed so the next inbound call gets it as
`misroute_context`.

**Example — JSON:**

```bash
curl -X POST "https://<edge-endpoint>/misroute" \
  -H "Content-Type: application/json" \
  -d '{"desk_line":"+15550000002","caller":"+15550001234","summary":"billing issue, but needs nurse triage","call_control_id":"CA..."}'
```

**Example — Query params (typical `dynamic_variables` shape):**

```bash
curl -X POST "https://<edge-endpoint>/misroute?desk=%2B15550000002&caller=%2B15550001234&ccid=CA...&summary=billing+issue%2C+needs+nurse+triage"
```

---

### 4. `GET /`

Renders a Telnyx-branded HTML status page with the 10 most recent
`routing` rows from the actor.

| Status Code | Body | Description |
|---|---|---|
| `200` | HTML | Always returns the page, even when there are no rows. |

---

### 5. `GET /healthz`

| Status Code | Body |
|---|---|
| `200` | `{ "ok": true, "service": "clinic-triage-handoff" }` |

---

## Status Codes Summary

| Code | Meaning |
|---|---|
| `200` | Success — request processed. |
| `404` | Not found — path does not match any route. |
| `502` | Warm-dial leg could not be originated (Telnyx REST returned non-2xx). |

---

## Idempotency & Exactly-Once Guarantees

- **`call.initiated` redelivery**: The actor's `routing` table has an
  idempotency check via `SELECT id FROM routing WHERE call_id = ?`; redelivered
  webhooks do not insert duplicate rows.
- **Specialist warm dial**: each dial carries a unique `command_id` so the
  Telnyx Call Control API deduplicates retries.
- **Conference accept**: the warm-transfer ring only joins both legs when
  DTMF `1` is captured; specialist decline hangs up the specialist leg and
  the caller leg stays on the receptionist for the fallback speak.
- **`/misroute` redelivery**: the actor upserts into `misroute_pending` with
  `ON CONFLICT(desk_line) DO UPDATE`, so a redelivered flag overwrites with
  the freshest summary instead of stacking rows.
- **Misroute context consumption**: `pendingMisrouteFor()` reads then
  `clearPendingMisroute()` deletes — the summary is delivered exactly once
  on the receiving desk's `call.initiated`.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELNYX_API_KEY` | yes | Telnyx REST API key (set via `telnyx-edge secrets add`). |
| `CONNECTION_ID` | yes | Telnyx Call Control application ID. |
| `WEBHOOK_URL` | yes | Public URL for the function's `/webhooks/voice` endpoint. |
| `AI_MODEL` | no | OpenAI-compatible model (default `gpt-4o-mini`). |
| `CLINIC_VOICE` | no | Voice used by the receptionist (default `Telnyx_Katie`). |
| `SPECIALIST_VOICE` | no | Voice used by specialist briefings (default `Telnyx_FLORA`). |
| `STATUS_PAGE_LINE` | no | E.164 line used to seed the status page router. |
| `ASSISTANT_ROUTES_JSON` | yes | Map of inbound line → Telnyx AI Assistant ID (JSON). |
| `MISROUTE_TARGETS_JSON` | yes | Map of desk line → desk line to dial on `flag_misroute` (JSON). |

See [`.env.example`](./.env.example) for shape examples of the two JSON maps.
