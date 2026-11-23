# API Reference — `night-nurse-line`

Typed contract for every HTTP route exposed by the Edge worker (`src/index.ts`) and every
actor RPC method reachable through `env.NURSES`, `env.ROTAS`, and `env.CLINIC`.

- **Base URL (local / deployed):** `https://<your-worker-host>` — all paths below are relative.
- **Content type:** `application/json` for every non-HTML route. HTML routes return
  `text/html; charset=utf-8`.
- **Authentication:** the worker itself is unauthenticated (it is a demo front end). The
  `/sms` route is authenticated by **Telnyx Ed25519 webhook signature**; all outbound Telnyx
  calls authenticate with `TELNYX_API_KEY` read from `env.SECRETS` — never from the browser.
- **Demo mode:** when `DEMO_MODE` is unset or anything other than `"false"`, outbound SMS is
  logged and never dispatched. Response shapes are identical in both modes.

---

## Route index

| Method | Path        | Purpose                                                        |
| ------ | ----------- | -------------------------------------------------------------- |
| `GET`  | `/`            | Relay chat page (Path B) — browser posts turns to `/chat`      |
| `GET`  | `/widget`      | Widget page (Path A) — `<telnyx-ai-agent text-only>` embed     |
| `POST` | `/chat`        | Relay a patient turn to the `NightNurse` actor                 |
| `POST` | `/conversation`| Ingest a widget-path transcript (Path A readback)              |
| `POST` | `/sms`         | Telnyx inbound-message webhook (rota changes + SMS chat)       |
| `GET`  | `/report`      | Clinic-wide morning report for a given PT day                  |
| `POST` | `/handoff`     | Force the daily handoff SMS + return the clinic report         |

---

## `GET /`

Serves the relay demo page (Path B). The page renders its own chat `<div>` and `POST`s each
completed patient turn to `/chat`. The patient handle is read from the `?patient=` query
string and defaults to `maya-481`.

**Query parameters**

| Name      | Type   | Required | Description                                                          |
| --------- | ------ | -------- | -------------------------------------------------------------------- |
| `patient` | string | no       | Patient handle used as `patientId` in every `/chat` call. Default `maya-481`. |

**Example**

```bash
curl -s "https://<your-worker-host>/?patient=maya-481"
```

**Responses**

| Status | Body                        |
| ------ | --------------------------- |
| `200`  | HTML document (`text/html`) |

---

## `GET /widget`

Serves the pure-widget demo page (Path A). Embeds
`<telnyx-ai-agent agent-id="..." text-only data-patient-handle="maya-481">` and loads
`@telnyx/ai-agent-widget` from `esm.sh`. The widget connects to Telnyx directly; a bridge
script forwards `agent.connected` (which carries the `conversationId`) and every
`transcript.item` to `POST /conversation`, so the actor ingests the transcript and runs
the chart/page logic via `GET /v2/ai/conversations/{id}/messages`. The assistant must have
`telephony_settings.supports_unauthenticated_web_calls` enabled (the setup script sets it).

**Query parameters** — none.

**Example**

```bash
curl -s "https://<your-worker-host>/widget"
```

**Responses**

| Status | Body                                                                                          |
| ------ | --------------------------------------------------------------------------------------------- |
| `200`  | HTML document (`text/html`) with the widget embed                                             |
| `500`  | `{"error":"NIGHT_NURSE_ASSISTANT_ID is not configured"}` — env var missing or not `^[A-Za-z0-9_-]{1,64}$` |

---

## `POST /chat`

Relays one patient turn to the durable `NightNurse` actor for that handle
(`env.NURSES.idFromName(patientId)`). The actor calls the Assistant Chat API with the stored
`conversation_id`, parses the trailing `TRIAGE:` line, writes chart facts to agent SQL, and —
on `page-on-call` — schedules exactly one on-call SMS.

**Request body**

| Field            | Type             | Required | Description                                                                                                     |
| ---------------- | ---------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `patientId`      | `string`         | **yes**  | Stable patient handle. Trimmed + lowercased. Must match `^[a-z0-9][a-z0-9-]{1,63}$`.                            |
| `text`           | `string`         | **yes**  | The patient's message. Trimmed. 1–2000 characters.                                                              |
| `conversationId` | `string \| null` | no       | Assistant conversation id from a previous turn. Ignored if the actor already holds one in durable state.        |

**Example request**

```bash
curl -s -X POST "https://<your-worker-host>/chat" \
  -H "content-type: application/json" \
  -d '{
    "patientId": "maya-481",
    "text": "chest tightness since dinner, 32 weeks pregnant",
    "conversationId": null
  }'
```

**Response — `200 OK`**

| Field            | Type                                                       | Description                                                                 |
| ---------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `patientId`      | `string`                                                   | Echo of the resolved handle.                                                |
| `content`        | `string`                                                   | Assistant reply with the `TRIAGE:` suffix stripped. During office hours on a non-red-flag turn this is the front-desk message instead. |
| `conversationId` | `string \| null`                                           | Assistant conversation id to pass back on the next turn.                    |
| `triage`         | `"self-care" \| "appointment" \| "page-on-call"`           | Verdict parsed from the reply. Missing suffix defaults to `"appointment"`.  |
| `pageSent`       | `boolean`                                                  | `true` once the on-call page has fired for this patient (durable, page-once). |
| `officeHours`    | `boolean`                                                  | Whether the turn landed inside 09:00–17:00 America/Los_Angeles, Mon–Fri.    |
| `redFlag`        | `boolean`                                                  | `true` when `triage === "page-on-call"`. Red flags bypass office hours.     |

```json
{
  "patientId": "maya-481",
  "content": "Call 911 now. I am paging the on-call OB.",
  "conversationId": "conv_01J8Z9K3T4",
  "triage": "page-on-call",
  "pageSent": true,
  "officeHours": false,
  "redFlag": true
}
```

**Response — `400 Bad Request`**

| Condition                          | Body                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `patientId` missing or malformed   | `{"error":"patientId must match ^[a-z0-9][a-z0-9-]{1,63}$"}`                 |
| `text` empty or longer than 2000   | `{"error":"text is required (max 2000 chars)"}`                              |

**Response — `500 Internal Server Error`**

| Condition                                                              | Body                        |
| ---------------------------------------------------------------------- | --------------------------- |
| `NIGHT_NURSE_ASSISTANT_ID` unset, Assistant Chat API failure, SQL error | `{"error":"internal error"}` |

**Status codes**

| Status | Meaning                                                                 |
| ------ | ----------------------------------------------------------------------- |
| `200`  | Turn processed; chart updated; page scheduled if verdict requires it.   |
| `400`  | Validation failure on `patientId` or `text`.                            |
| `500`  | Upstream assistant failure, missing config, or SQL error (details logged only). |

---

## `POST /conversation`

Ingests a widget-path conversation. The widget page's bridge script calls this on
`agent.connected` (whose detail carries the `conversationId`) and on every
`transcript.item`. The actor fetches the transcript via
`GET /v2/ai/conversations/{id}/messages`, extracts chart facts from each new patient
turn, and runs the same page-once guard as the relay path. Ingestion is idempotent —
the actor tracks how many transcript messages it has already processed, so repeat
bridge calls (and re-connects) never double-count chats or double-page.

**Request body**

| Field             | Type     | Required | Description                                                            |
| ----------------- | -------- | -------- | ---------------------------------------------------------------------- |
| `patientId`       | `string` | yes      | Patient handle; must match `^[a-z0-9][a-z0-9-]{1,63}$`.                |
| `conversationId`  | `string` | yes      | Widget conversation id from the `agent.connected` event detail; must match `^[A-Za-z0-9_-]{1,128}$`. |

**Example**

```bash
curl -s -X POST "https://<your-worker-host>/conversation" \
  -H 'content-type: application/json' \
  -d '{"patientId":"maya-481","conversationId":"conv_01J8Z9K3T4"}'
```

**Response — `200 OK`**

| Field            | Type                                             | Description                                                                 |
| ---------------- | ------------------------------------------------ | ---------------------------------------------------------------------------- |
| `patientId`      | `string`                                         | Echo of the resolved handle.                                                 |
| `conversationId` | `string`                                         | Echo of the ingested conversation id.                                        |
| `ingested`       | `number`                                         | Number of transcript messages processed in this call (0 when nothing new).   |
| `triage`         | `"self-care" \| "appointment" \| "page-on-call"` | Verdict parsed from the latest assistant turn (missing suffix → `appointment`). |
| `pageSent`       | `boolean`                                        | `true` once the on-call page has fired for this patient (durable, page-once). |

**Response — `400 Bad Request`**

| Condition                                  | Body                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `patientId` missing or malformed           | `{"error":"patientId must match ^[a-z0-9][a-z0-9-]{1,63}$"}`                                        |
| `conversationId` missing or malformed      | `{"error":"conversationId must match ^[A-Za-z0-9_-]{1,128}$"}`                                      |

**Status codes**

| Status | Meaning                                                                                     |
| ------ | --------------------------------------------------------------------------------------------- |
| `200`  | Transcript ingested; chart updated; page scheduled if a new `page-on-call` verdict required it. |
| `400`  | Validation failure on `patientId` or `conversationId`.                                        |
| `500`  | Conversation readback failure, missing config, or SQL error (details logged only).            |

---

## `POST /sms`

Telnyx **Inbound Message Webhook** target for the demo number. Verifies the Ed25519
signature, then routes the message body:

- `ONCALL <number>` → `RotaDesk.setNumber()` — updates the shared on-call rota row.
- `PATIENT <handle> <text>` → forwards the text to that patient's `NightNurse` actor and
  replies to the sender with the assistant's `content`.
- Anything else → acknowledged and ignored.

**Headers**

| Header                      | Required | Description                                                             |
| --------------------------- | -------- | ----------------------------------------------------------------------- |
| `telnyx-signature-ed25519`  | **yes**\* | Base64 Ed25519 signature over `"{timestamp}|{raw_body}"`.              |
| `telnyx-timestamp`          | **yes**\* | Unix seconds. Rejected if more than 300 s from server time.             |
| `content-type`              | **yes**  | `application/json`.                                                     |

\* In demo mode only, a missing `TELNYX_PUBLIC_KEY` secret causes the signature check to be
skipped with a warning. In live mode (`DEMO_MODE=false`) a missing key rejects every request.

**Request body** — standard Telnyx `message.received` event envelope (only the fields the
handler reads are listed).

| Field                                    | Type     | Required | Description                                     |
| ---------------------------------------- | -------- | -------- | ----------------------------------------------- |
| `data.event_type`                        | `string` | **yes**  | Must be `"message.received"`; all others are acked and ignored. |
| `data.payload.from.phone_number`         | `string` | no       | Sender in E.164. Used as `updatedBy` (masked) and as the SMS reply destination. |
| `data.payload.text`                      | `string` | no       | Message body. Empty bodies are acked and ignored. |

**Example request (rota change)**

```bash
curl -s -X POST "https://<your-worker-host>/sms" \
  -H "content-type: application/json" \
  -H "telnyx-signature-ed25519: <base64-signature>" \
  -H "telnyx-timestamp: 1762747200" \
  -d '{
    "data": {
      "event_type": "message.received",
      "payload": {
        "from": { "phone_number": "+15551230001" },
        "text": "ONCALL +15551230099"
      }
    }
  }'
```

**Example request (patient SMS chat)**

```bash
curl -s -X POST "https://<your-worker-host>/sms" \
  -H "content-type: application/json" \
  -H "telnyx-signature-ed25519: <base64-signature>" \
  -H "telnyx-timestamp: 1762747200" \
  -d '{
    "data": {
      "event_type": "message.received",
      "payload": {
        "from": { "phone_number": "+15551230001" },
        "text": "PATIENT maya-481 the tightness stopped, do I still see my doctor?"
      }
    }
  }'
```

**Response — `200 OK`** (three shapes)

| Shape                                | When                                                             |
| ------------------------------------ | ---------------------------------------------------------------- |
| `{"received":true,"ignored":true}`   | Non-`message.received` event, empty text, or unrecognized command. |
| `{"received":true,"rota":"+1******0099"}` | `ONCALL <number>` matched; rota row updated. Number is masked. |
| `{"received":true,"replied":true}`   | `PATIENT <handle> <text>` matched; actor replied and SMS was sent back. |

**Response — `400 Bad Request`**

| Condition          | Body                        |
| ------------------ | --------------------------- |
| Body is not JSON   | `{"error":"invalid json"}`  |

**Response — `401 Unauthorized`**

| Condition                                                        | Body                            |
| ---------------------------------------------------------------- | ------------------------------- |
| Missing/invalid signature, stale timestamp, or no public key in live mode | `{"error":"invalid signature"}` |

**Status codes**

| Status | Meaning                                                              |
| ------ | -------------------------------------------------------------------- |
| `200`  | Event accepted (processed or deliberately ignored).                  |
| `400`  | Malformed JSON body.                                                 |
| `401`  | Ed25519 signature verification failed.                               |
| `500`  | Unhandled error inside the handler (details logged only).            |

---

## `GET /report`

Returns the **clinic-wide** morning report for a Pacific-time day, aggregated by the
`ClinicDesk` actor from the shared `sessions` and `pages` tables.

**Query parameters**

| Name  | Type     | Required | Description                                                       |
| ----- | -------- | -------- | ----------------------------------------------------------------- |
| `day` | `string` | no       | `YYYY-MM-DD` in America/Los_Angeles. Defaults to today (PT).      |

**Example request**

```bash
curl -s "https://<your-worker-host>/report?day=2026-11-10"
```

**Response — `200 OK`**

| Field          | Type     | Description                                        |
| -------------- | -------- | -------------------------------------------------- |
| `day`          | `string` | The resolved `YYYY-MM-DD` day.                     |
| `chats`        | `number` | Total sessions recorded that day (all patients).   |
| `pages`        | `number` | On-call pages dispatched that day.                 |
| `selfCare`     | `number` | Sessions with verdict `self-care`.                 |
| `appointments` | `number` | Sessions with verdict `appointment`.               |
| `pageOnCall`   | `number` | Sessions with verdict `page-on-call`.              |

```json
{
  "day": "2026-11-10",
  "chats": 3,
  "pages": 1,
  "selfCare": 0,
  "appointments": 2,
  "pageOnCall": 1
}
```

**Response — `400 Bad Request`**

| Condition                    | Body                                          |
| ---------------------------- | --------------------------------------------- |
| `day` not `YYYY-MM-DD`       | `{"error":"day must be YYYY-MM-DD"}`          |

**Status codes**

| Status | Meaning                                        |
| ------ | ---------------------------------------------- |
| `200`  | Report computed.                               |
| `400`  | `day` failed the format check.                 |
| `500`  | SQL or actor error (details logged only).      |

---

## `POST /handoff`

Forces the daily handoff immediately: `ClinicDesk.dailyHandoff()` builds today's clinic
report and sends one summary SMS to `DAY_TEAM_E164` (skipped with a warning if that env var
is not a valid E.164 number). The same summary is also produced automatically once per day
by the actor's `every(86400, "dailyHandoff")` schedule.

**Request body** — none.

**Example request**

```bash
curl -s -X POST "https://<your-worker-host>/handoff"
```

**Response — `200 OK`** — identical shape to `GET /report`.

```json
{
  "day": "2026-11-10",
  "chats": 3,
  "pages": 1,
  "selfCare": 0,
  "appointments": 2,
  "pageOnCall": 1
}
```

**Status codes**

| Status | Meaning                                              |
| ------ | ---------------------------------------------------- |
| `200`  | Handoff executed (SMS sent or skipped) and report returned. |
| `500`  | SQL or actor error (details logged only).            |

---

## Unmatched routes

Any method/path combination not listed above returns:

| Status | Body                      |
| ------ | ------------------------- |
| `404`  | `{"error":"not found"}`   |

---

## Actor RPC surface

These methods are invoked through actor stubs (`env.<NS>.idFromName(name)`), not over HTTP.
They are documented here because they form the durable contract the HTTP routes depend on.

### `NightNurse` — `env.NURSES.idFromName(patientId)`

| Method                       | Input                                                     | Returns          | Notes                                                                                     |
| ---------------------------- | --------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `chat(input)`                | `{ patientId: string; text: string; conversationId?: string \| null }` | `ChatResult`     | Same contract as `POST /chat`. Throws on invalid handle or missing `NIGHT_NURSE_ASSISTANT_ID`. |
| `report(day)`                | `day: string` (`YYYY-MM-DD`)                              | `PatientReport`  | Per-patient counts from `sessions` + `pages`.                                              |
| `pageOnCall(payload)`        | `{ patientId: string; summary: string }`                  | `void`           | Scheduled task (`this.schedule(0, "pageOnCall", …)`). Reads the live rota via `RotaDesk.current()`, sends the SMS, writes the `pages` row. |

**`PatientReport`**

| Field          | Type     | Description                          |
| -------------- | -------- | ------------------------------------ |
| `patientId`    | `string` | The patient handle.                  |
| `day`          | `string` | `YYYY-MM-DD` (PT).                   |
| `chats`        | `number` | Sessions for this patient that day.  |
| `pages`        | `number` | Pages for this patient that day.     |
| `selfCare`     | `number` | Verdict `self-care` count.           |
| `appointments` | `number` | Verdict `appointment` count.         |
| `pageOnCall`   | `number` | Verdict `page-on-call` count.        |

### `RotaDesk` — `env.ROTAS.idFromName("oncall")`

| Method                    | Input                                          | Returns      | Notes                                                                                   |
| ------------------------- | ---------------------------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| `current()`               | —                                              | `string`     | Returns the rota row's E.164 number. Seeds the row from `ONCALL_E164` on first call. Throws if the seed is not valid E.164. |
| `setNumber(input)`        | `{ number: string; updatedBy: string }`        | `RotaState`  | Normalizes to E.164 (10 digits → `+1…`), validates, upserts the single `rota` row.       |

**`RotaState`**

| Field       | Type     | Description                                    |
| ----------- | -------- | ---------------------------------------------- |
| `number`    | `string` | Current on-call number in E.164.               |
| `updatedBy` | `string` | Masked sender handle or `"env-seed"`.          |
| `updatedAt` | `string` | ISO-8601 timestamp of the last change.         |

### `ClinicDesk` — `env.CLINIC.idFromName("clinic")`

| Method           | Input             | Returns        | Notes                                                                     |
| ---------------- | ----------------- | -------------- | ------------------------------------------------------------------------- |
| `arm()`          | —                 | `void`         | Idempotently registers `this.every(86400, "dailyHandoff")`.               |
| `report(day)`    | `day: string`     | `ClinicReport` | Clinic-wide aggregation across all patients.                              |
| `dailyHandoff()` | —                 | `ClinicReport` | Builds today's report, sends the `DAY_TEAM_E164` summary SMS, records `lastHandoff`. |

**`ClinicReport`** — `{ day, chats, pages, selfCare, appointments, pageOnCall }`, all
`number` except `day` (`string`). Identical to the `GET /report` response body.

---

## Error envelope

Every JSON error response uses a single-key envelope:

```json
{ "error": "<human-readable reason>" }
```

Internal failures always return the generic `{"error":"internal error"}` with status `500`;
the underlying exception message is written to the worker log only and never echoed to the
client. Phone numbers are masked (`+1******0099`) in logs, `pages.to_number` rows, and the
`/sms` rota acknowledgement.
