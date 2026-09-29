# Guide

## Environment

| Variable | Purpose |
|---|---|
| `TELNYX_API_KEY` | Telnyx API key |
| `TELNYX_CONNECTION_ID` | Call Control Application ID |
| `TELNYX_PHONE_NUMBER` | Telnyx caller ID and transfer origin |
| `HUMAN_TRANSFER_NUMBER` | Specialist destination |
| `TELNYX_AI_MODEL` | Model used for bounded gather results |
| `BILLING_VOICE` | Ultra voice for the billing agent |
| `SPECIALIST_VOICE` | Ultra voice for the specialist leg |
| `PORT` | Local Flask port |

## Run

```bash
python app.py
ngrok http 5000
```

Set the Call Control Application webhook to the public URL plus
`/webhooks/voice`.

## State transitions

```text
incoming call
  -> answer
  -> billing greeting
  -> gather billing issue
  -> ask for consent
  -> dial specialist
  -> specialist introduction
  -> bridge original and specialist legs
```
