# Tutorial: Build an RCS Capability Campaign Desk

This guide walks you through building an adaptive RCS/SMS campaign sender that checks device capabilities before sending, generates content with AI, and provides a web dashboard for the entire workflow.

## Prerequisites

- Python 3.10+
- A [Telnyx account](https://portal.telnyx.com) with:
  - An API key
  - An RCS Business Messaging agent (with agent ID)
  - A messaging profile
  - A Telnyx phone number

## Step 1: Project Setup

Clone the repo and install dependencies:

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/rcs-capability-campaign-desk-python
pip install -r requirements.txt
```

Copy the environment template and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```
TELNYX_API_KEY=KEYxxxxxxxxxxxxxxxx
RCS_AGENT_ID=your_agent_id_from_portal
MESSAGING_PROFILE_ID=your_messaging_profile_id
BOT_NUMBER=+15551234567
```

## Step 2: Understand the Decision Ladder

The core logic is a pure function called `decide_format()` that takes two inputs:

1. **Line type** from Number Lookup (mobile, landline, voip)
2. **RCS features** from the Capabilities API (e.g., `RICHCARD_STANDALONE`)

It returns one of four outcomes:

| Line Type | RCS Features | Result |
|-----------|--------------|--------|
| Landline / VoIP | (any) | SMS only |
| Mobile | `RICHCARD_STANDALONE` present | Rich card + SMS fallback |
| Mobile | Some features, no rich cards | Plain RCS + SMS fallback |
| Mobile | No features | SMS only |

This function has no side effects and is fully unit-testable.

## Step 3: Run the App

```bash
python app.py
```

Open http://localhost:5050 in your browser. You'll see the dark-theme dashboard with three tabs.

## Step 4: Check Device Capabilities

Navigate to the **Capability Check** tab:

1. Enter a phone number (E.164 format, e.g., `+12125551234`)
2. Click **Check Capability**
3. View the results:
   - **Number Lookup**: carrier name, line type, country
   - **RCS Capabilities**: list of supported features
   - **Recommendation**: color-coded tier badge and format recommendation

The API calls behind this tab:

```
GET /v2/number_lookup/+12125551234
GET /v2/messaging/rcs/capabilities/{agent_id}/+12125551234
```

## Step 5: Generate Campaign Content with AI

Navigate to the **Adaptive Send** tab:

1. Enter a campaign prompt (e.g., "Flash sale: 30% off all plans this weekend")
2. Click **Generate Content**
3. Preview the generated:
   - **RCS Rich Card**: title, description, and action button
   - **SMS Fallback**: plain-text version with URL

The AI call:

```
POST /v2/ai/chat/completions
{
  "model": "THUDM/GLM3-flash",
  "messages": [
    {"role": "system", "content": "You are an RCS marketing content generator..."},
    {"role": "user", "content": "Flash sale: 30% off all plans this weekend"}
  ]
}
```

## Step 6: Send an Adaptive Message

Still on the **Adaptive Send** tab:

1. Enter a recipient phone number
2. Click **Send Adaptive Message**
3. The app runs the capability check, applies the decision ladder, and sends
4. View the **decision trace** showing which format was chosen and why
5. See per-channel send results (success/failure, message IDs)

## Step 7: Create a Deeplink with QR Code

Navigate to the **Deeplink & QR** tab:

1. Enter a message body (what the user will see pre-filled)
2. Click **Generate Deeplink**
3. Copy the deeplink URL or scan the QR code on a mobile device

The QR code is generated entirely client-side using qrcode.js — no server-side dependency needed.

## Step 8: Run Tests

```bash
python smoke_test.py
```

The test suite covers:
- All 4 branches of `decide_format()` (landline, full RCS, basic RCS, no RCS)
- All API routes with mocked HTTP calls
- Input validation (missing phone, missing prompt)
- End-to-end send flow for a landline number

## Next Steps

- **Edge Compute**: Deploy `decide_format()` as a Telnyx Edge Function for sub-10ms decision latency
- **Batch sends**: Extend `/api/send` to accept an array of phone numbers for campaign blasts
- **Analytics**: Store send results in a database and build a delivery report dashboard
- **Webhook handling**: Add a `/webhooks/messaging` endpoint to track delivery receipts

## Resources

- [RCS Messaging Guide](https://developers.telnyx.com/docs/messaging/rcs)
- [Number Lookup API](https://developers.telnyx.com/api/number-lookup)
- [AI Inference API](https://developers.telnyx.com/api/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
