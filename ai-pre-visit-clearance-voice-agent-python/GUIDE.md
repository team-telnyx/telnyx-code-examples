# AI Pre-Visit Clearance Voice Agent - Build Guide

Patients call to request insurance clearance (prior authorization) before a visit. The agent verifies identity, classifies the request with AI, confirms details, creates a ticket, and notifies patient and staff.

## How It Works

```
patient calls
  -> telnyx voice webhook
  -> flask app
  -> verify by caller ID or DOB
  -> gather spoken answers with one-turn AI speech capture
  -> ai inference: classify procedure + urgency + type
  -> confirm with patient (yes/no)
  -> create ticket + SMS to patient + Slack to staff
```

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with voice enabled
- [Call Control Application](https://portal.telnyx.com/call-control/applications)
- [ngrok](https://ngrok.com)

## Step 1: Set Up

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/ai-pre-visit-clearance-voice-agent-python
cp .env.example .env
pip install -r requirements.txt
```

## Step 2: Run

```bash
python app.py
ngrok http 5000
```

Set webhook URL in [Telnyx Portal](https://portal.telnyx.com):
- Call Control Application -> `https://<id>.ngrok-free.app/webhooks/voice`

## Step 3: Test

```bash
curl -X POST http://localhost:5000/patients -H "Content-Type: application/json" -d '{"patient_id":"P001","name":"Jordan","phone":"+15551112233","dob":"03/15/1990","insurance":"Blue Cross","provider":"Dr. Smith"}'
```

Call the number, answer the DOB prompt, say "I need clearance for an MRI on my lower back", confirm with "yes".

## Resources

- [Source code](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-pre-visit-clearance-voice-agent-python)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
