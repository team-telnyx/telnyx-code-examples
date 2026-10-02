# Guide

## Environment

| Variable | Purpose |
|---|---|
| `TELNYX_API_KEY` | Telnyx API key |
| `TELNYX_PHONE_NUMBER` | Number the AI Assistant transfers from |
| `BILLING_SPECIALIST_NUMBER` | Transfer tool target |
| `ASSISTANT_NAME` | Name for the AI Assistant |
| `TELNYX_AI_MODEL` | Optional AI model override |

## Flow

```text
python app.py
  -> creates a Telnyx AI Assistant
  -> adds the built-in transfer tool
  -> configures Billing Specialist as the target
  -> sets warm_transfer_instructions
  -> enables warm_transfer_acceptance
  -> keeps the private specialist consult out of the caller conversation record
```

You can create the same setup in the Telnyx Mission Control Portal by adding a
Transfer tool to an AI Assistant, setting the billing specialist target, adding
warm transfer instructions, and enabling warm transfer acceptance.
