# Guide

## Environment

| Variable | Purpose |
|---|---|
| `TELNYX_API_KEY` | Telnyx API key |
| `TELNYX_CONNECTION_ID` | Call Control Application ID |
| `TELNYX_PHONE_NUMBER` | Telnyx number that receives the inbound call |
| `HUMAN_TRANSFER_NUMBER` | Specialist destination to dial |
| `SPECIALIST_FROM_NUMBER` | Optional caller ID for the specialist leg |
| `TELNYX_AI_MODEL` | Optional AI model override |
| `BILLING_VOICE` | Optional billing-agent voice override |
| `SPECIALIST_VOICE` | Optional specialist-agent voice override |

## Flow

```text
inbound call
  -> answer
  -> BILLING_AGENT_PROMPT gathers issue + transfer approval
  -> start_specialist_transfer() dials HUMAN_TRANSFER_NUMBER
  -> bridge_to_specialist() bridges the calls
  -> SPECIALIST_AGENT_PROMPT continues with context
```
