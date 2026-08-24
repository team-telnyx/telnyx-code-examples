# CustomerAgent LangGraph Edge Build Plan

## Goal

Build the DEV-839 flagship demo as a cloned Telnyx Edge project, not by modifying the existing `langgraph-agent-on-edge` example. The durable actor represents the customer, using Anusha as the demo customer.

The first working milestone is SMS-only:

1. Anusha texts the Telnyx number.
2. Telnyx Messaging webhook routes to the Edge function.
3. The Edge function routes by customer phone number into one durable actor.
4. LangGraph runs inside that actor.
5. The actor sends an SMS reply from `+15551234567`.
6. `/events` and `/context` show that state/history stayed on the same actor.

## Current Known-Good Inputs

- Working Telnyx outbound SMS sender: `+15551234567`
- Demo customer phone: `+15557654321`
- Demo customer name: `Anusha`
- Telnyx 10DLC campaign exists and is active.
- Direct Telnyx Messages API can send SMS from `+15551234567`.
- Do not print or commit API keys, Salesforce secrets, or 1Password values.

## Current Project State

Main cloned project:

- `/Users/anushathukral/Documents/Projects/telnyx-code-examples/persistent-state-agent`

SMS deploy experiments:

- `/Users/anushathukral/Documents/Projects/telnyx-code-examples/customer-agent-sms-gate`
- `/Users/anushathukral/Documents/Projects/telnyx-code-examples/customer-agent-sms-live`
- `/Users/anushathukral/Documents/Projects/telnyx-code-examples/customer-agent-sms-milestone`

Local validation passes:

- `npm run typecheck`
- `npm test`

Current Telnyx Edge blocker:

- New cloned actor types are not reaching `deploy_ok`.
- `CustomerAgent`, `CustomerAgentSmsGate`, and `CustomerAgentSmsLive` show failed actor registration.
- `customer-agent-sms-milestone` is still pending/deploying at last check.
- Existing deployed Edge routes also timed out from curl, so verify platform health before more code churn.

Current local progress while Edge is with on-call:

- LangGraph action node now calls a Salesforce-shaped tool instead of a hardcoded order table.
- Salesforce mock mode supports shipment lookup and shipment status update.
- Real Salesforce mode has OAuth2 client-credentials request wiring for `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_DOMAIN`, and `SF_API_VERSION`.
- `POST /webhooks/salesforce` routes a shipment update into the same customer actor by `phone_e164`.
- `CustomerAgent.ingestSalesforceUpdate()` updates durable `shipments`, writes through the Salesforce tool, and records the proactive SMS step in demo mode.
- Local validation currently passes: `npm run typecheck` and `npm test`.

## Step-by-Step Delivery Plan

### Step 1: SMS Transport Only

Acceptance gate:

- `curl /health` returns 200 for the cloned function.
- `POST /send` with `{ "from": "+15557654321", "text": "where is order ORD-10042?" }` sends a real SMS to Anusha.
- `/events?from=%2B14157986793` shows inbound, graph execution, outbound, and committed turn state.

Implementation notes:

- Keep `SMS_TRANSPORT=production`.
- Use `DEMO_FROM_NUMBER=+15551234567`.
- Do not connect Salesforce yet.
- Use mock order lookup until SMS + state is stable.

### Step 2: Durable Customer State

Acceptance gate:

- Send two separate `/send` calls for the same `from` number.
- Both calls route to the same actor name.
- `/context?phone=%2B14157986793` shows persisted history and turn counters.
- Restart/redeploy does not require conversation reconstruction.

State should include:

- `phone_e164`
- `name`
- `salesforce_id`
- `history`
- `preferences`
- `open_tickets`
- `shipments`
- `lastIntent`
- turn processing fields

### Step 3: Real Inbound SMS Webhook

Acceptance gate:

- Messaging profile webhook points at `/webhooks/messaging`.
- Anusha texts `+15551234567`.
- The same actor wakes and replies.
- Duplicate webhook event IDs are ignored.

Implementation notes:

- Verify Telnyx webhook signatures only in production transport.
- Keep `/send` as a debug path for demo control.

### Step 4: Salesforce Read Tool

Acceptance gate:

- Customer state can be hydrated from Salesforce by phone or Salesforce ID.
- LangGraph can answer an order/shipment question from Salesforce data.
- Session expiration reauth path is tested.

Use the OAuth client-credentials code supplied by Anusha, adapted to Edge-safe TypeScript REST calls.

Required env/secrets:

- `SF_CLIENT_ID`
- `SF_CLIENT_SECRET`
- `SF_DOMAIN`

Local status:

- Mock shipment reads are implemented and covered by tests.
- Real OAuth client-credentials request shape is implemented and covered by tests with mocked `fetch`.
- Still needed: validate against Anusha's actual Salesforce org once credentials are available in a local `.env` or Edge secrets.

### Step 5: Salesforce Write Tool

Acceptance gate:

- SMS intent updates a safe Salesforce field or creates a task/case note.
- Write result is recorded in actor state and process log.
- Failed writes return a clear SMS fallback and do not corrupt state.

Local status:

- Mock shipment status writes are implemented and covered by tests.
- `/webhooks/salesforce` can update the durable actor shipment state locally once the actor runtime is available.
- Still needed: choose the real Salesforce object/field for the demo write, for example `Shipment__c.Status__c`, a Case note, or a Task.

### Step 6: Human-In-The-Loop

Acceptance gate:

- Actor detects authorization/escalation need.
- Actor records `escalation_pending`.
- Human response endpoint resumes the same actor.
- Customer gets a final SMS after human resolution.

### Step 7: Self-Wake Scheduling

Acceptance gate:

- Salesforce shipment update webhook updates actor state.
- Actor schedules a future follow-up.
- `onSchedule` wakes the same customer actor and sends proactive SMS.

### Step 8: Voice Channel

Acceptance gate:

- Inbound call routes to the same customer actor.
- AI Assistant handles voice reasoning/tool calls inside the actor flow.
- Hangup triggers SMS follow-up from the same customer state.

## OpenCode Instructions

Work one gate at a time. Do not start Salesforce, voice, HITL, or schedule work until the SMS-only gate is green.

Before each gate:

1. Run `npm run typecheck`.
2. Run `npm test`.
3. Deploy only the cloned project or a fresh clone.
4. Verify with curl and, for SMS, with a real received message.

Do not modify the original `langgraph-agent-on-edge` example except for read-only comparison.
