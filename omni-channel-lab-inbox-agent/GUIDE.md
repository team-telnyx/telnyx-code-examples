# Guide: Omni-Channel Lab Inbox Agent

A step-by-step walkthrough of the lab-result intake workflow on Telnyx Edge Compute — from fax arrival to patient confirmation to the voice-agent call.

## What you'll build

A single Edge Compute function that gives a hospital intake team:

- **A unified inbox UI** — faxes, SMS threads, email, and voice transcripts on one patient, in one place
- **A human-in-the-loop fax workflow** — operator reviews the PDF, accepts it (original deleted, only a reference kept), approves the AI-drafted confirmation
- **A voice agent** that answers patient calls, verifies a case reference, and reports status — never touching lab content
- **SMS auto-replies** that answer location, appointment, and status questions from the patient's own record
- **Email confirmations** with live delivery tracking (queued → sent → delivered)

## How it works

```
  Hospital Lab faxes the result PDF
        │
        ▼
  fax.ended webhook → document record + case reference (LAB-YYYYMMDD-NNN)
        │
        ▼
  Operator reviews the PDF (the only persona that sees lab content)
        │
        ▼
  Operator clicks Accept → DELETE /v2/faxes/{id} → only reference + status survive
        │
        ▼
  AI drafts a confirmation email from metadata → operator approves → Email API sends
        │
        ▼
  Patient opens the email (delivery events recorded)
        │
        ▼
  Patient calls → voice agent verifies the reference →
  "your results were already emailed to you — check your inbox"
```

The safety boundary: the AI's only tool returns workflow status — it structurally cannot reach lab content. Every outbound message requires human approval. After Accept, no lab content persists anywhere.

## Step 1 — Deploy the function

Follow the README setup: install dependencies, fill in `telnyx.toml`, add secrets, then:

```bash
telnyx-edge new-func --actor --name=omni-channel-lab-inbox-agent
# copy the printed func_id into telnyx.toml [edge_compute]
npm run ship
```

Note the deployed URL: `https://omni-channel-lab-inbox-agent-<id>.telnyxcompute.com`

## Step 2 — Wire the channels

Point each Telnyx product's webhook at the deployed function:

| Product | Webhook URL |
|---|---|
| Call Control application | `.../webhooks/voice` |
| Fax application | `.../webhooks/fax` |
| Messaging profile | `.../webhooks/messaging` |
| Email domain | `.../webhooks/email` |

The voice experience uses a **managed Telnyx AI Assistant** assigned to your voice number. Its instructions tell it to collect a case reference, use the lookup tool, and escalate clinical questions. Attach the tool:

```bash
curl -X PATCH "https://api.telnyx.com/v2/ai/assistants/$ASSISTANT_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tools": [
      {
        "type": "webhook",
        "timeout_ms": 30000,
        "webhook": {
          "name": "lookup_lab_document",
          "description": "Look up the receipt and processing status of a lab document by its case reference. Use this whenever a caller mentions a case or reference number, or asks whether their lab document was received.",
          "url": "https://<your-func>.telnyxcompute.com/ai-assistant/lookup",
          "method": "POST",
          "async": false,
          "timeout_ms": 30000,
          "body_parameters": {
            "type": "object",
            "properties": {
              "reference": {
                "type": "string",
                "description": "The case reference number the caller provided"
              }
            },
            "required": ["reference"]
          }
        }
      }
    ]
  }'
```

Note: `name` and `description` live **inside** the `webhook` object — not at the tool root.

## Step 3 — Run the workflow

Open the deployed URL in a browser for the admin inbox, then:

1. **Book appointment** — books the demo patient's appointment and texts them a confirmation
2. **Simulate incoming fax** — creates a document with a sample lab report (or send a real fax to your fax number)
3. The document appears with status `received` — click **Download PDF** to review it (this flips status to `reviewed`)
4. Click **Accept** — the original fax is deleted from Telnyx; the download disappears; only the reference and status remain
5. The AI drafts the confirmation email — click **Approve & send**; the patient email comes from the case (prompted only if none is on file)
6. Delivery timeline appears under the sent email (queued → sent → delivered)
7. **Simulate: patient opened email** — records the open
8. **Mark visit complete** — texts the patient that results will arrive in 1–3 business days

## Step 4 — The patient calls

Call the voice number from the demo patient's phone:

- Caller: *"I'm calling about my lab results"*
- Agent: asks for the case reference
- Caller: gives it (full, sloppy, or just the last 3 digits — the lookup tolerates all)
- Agent: *"Your results were already emailed to you on [date] — please check your email, including spam."*
- Caller: *"What did my results show?"*
- Agent: *"I'm not able to discuss lab results or medical questions, but your full results are in your email, and I can connect you with our staff."*

The tolerant lookup handles: `LAB-20260901-472`, `2026 09 01 472`, or just `472`.

## Step 5 — Inspect the state

Open `/db` in a browser. Pick the patient's actor (phone digits) and browse the tables:

- `documents` — after Accept: `fax_id: null`, `deleted_at` set, `emailed_to` + `email_sent_at` filled
- `appointments` — status `completed`
- `messages` — every SMS, email, and voice turn on the case

Reset everything between runs with `POST /api/demo/reset`.

## Design notes

- **One fax = one case.** Each incoming fax creates its own conversation and document record on the patient's actor.
- **Actor names are alphanumeric only.** Dapr rejects `+`/`@` in actor IDs — phone numbers and emails are stripped to digits/letters before use as actor keys.
- **S3 media URLs expire hourly.** Downloads always mint a fresh signed URL at click time (refresh action + re-fetch), so the operator is never blocked.
- **Simulated faxes** have no real Telnyx fax behind them — the download serves the hosted sample PDF, and Accept skips the DELETE call.
- **Email open tracking** requires a custom verified domain (shared domains can't enable it). The delivery timeline renders any event Telnyx emits, so opens appear automatically once tracking is on.
