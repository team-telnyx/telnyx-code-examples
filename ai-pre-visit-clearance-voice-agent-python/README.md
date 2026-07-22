---
name: ai-pre-visit-clearance-voice-agent
title: "AI Pre-Visit Clearance Voice Agent"
description: "Inbound voice agent for healthcare pre-visit insurance clearance. Patients call to request prior authorization for a procedure, test, or medication. The agent verifies identity by DOB, collects procedure/provider/insurer, classifies urgency with AI, creates a structured intake ticket for billing staff, and sends an SMS confirmation."
language: python
framework: flask
telnyx_products: [Voice, AI Inference, Messaging]
integrations: [Slack]
channel: [voice, sms]
---

# AI Pre-Visit Clearance Voice Agent

Inbound voice and SMS agent for healthcare pre-visit insurance clearance. Patients call to request prior authorization for a procedure, test, or medication. The agent verifies identity by DOB, classifies urgency with AI Inference, creates a structured intake ticket for billing staff, and sends an SMS confirmation. Non-clinical: no medical advice, no coverage decisions.

## Telnyx API Endpoints Used

- **Call Control: Answer**: `POST /v2/calls/{id}/actions/answer` - [API reference](https://developers.telnyx.com/api/call-control/answer-call)
- **Call Control: Speak**: `POST /v2/calls/{id}/actions/speak` - [API reference](https://developers.telnyx.com/api/call-control/speak)
- **Call Control: Gather Using AI**: `POST /v2/calls/{id}/actions/gather_using_ai` - [API reference](https://developers.telnyx.com/api/call-control/gather-using-ai)
- **AI Inference**: `POST /v2/ai/chat/completions` - [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-pre-visit-clearance-voice-agent-python
cp .env.example .env
pip install -r requirements.txt
python app.py
```

## API Reference

### `GET /health`

```bash
curl http://localhost:5000/health
```

```json
{"open_tickets": 0, "patients": 1, "status": "ok", "active_calls": 0}
```

### `POST /patients`

```bash
curl -X POST http://localhost:5000/patients -H "Content-Type: application/json" -d '{"patient_id":"P001","name":"Jordan","phone":"+15551112233","dob":"03/15/1990","insurance":"Blue Cross","provider":"Dr. Smith"}'
```

### `GET /tickets`

```bash
curl http://localhost:5000/tickets
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid API key | Verify `TELNYX_API_KEY` in [Portal](https://portal.telnyx.com/api-keys) |
| Webhook not received | Local server not reachable | Use ngrok and set webhook in [Portal](https://portal.telnyx.com) |

## Related Examples

- [AI Medical Appointment Prep Caller](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-medical-appointment-prep-caller-python/README.md)
- [AI Insurance Claims Intake](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-insurance-claims-intake-voice-python/README.md)
- [Prescription Refill Line](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/prescription-refill-line-python/README.md)

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
