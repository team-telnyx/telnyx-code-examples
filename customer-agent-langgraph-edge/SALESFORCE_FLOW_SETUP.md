# Salesforce Flow Setup — Meeting Time Reschedule Detection

This document describes how to configure a Salesforce record-triggered Flow that calls the Edge webhook when `Meeting_Time__c` is manually changed on a Lead.

## Prerequisites

- Salesforce admin access to the Telnyx org
- The custom fields `Meeting_Time__c`, `Meeting_Status__c`, `SDR_Assigned__c` must exist on the Lead object
- The Edge function must be deployed at:
  ```
  https://customer-agent-langgraph-edge-bd2578f9-6.telnyxcompute.com/webhooks/salesforce-lead-change
  ```

## Step 1 — Create a Named Credential (or External Credential)

1. Go to **Setup → Named Credentials**
2. Click **New Named Credential**
3. Name: `CustomerAgent_Edge`
4. URL: `https://customer-agent-langgraph-edge-bd2578f9-6.telnyxcompute.com`
5. Identity Type: **Anonymous** (no auth for the demo)
6. Click **Save**

## Step 2 — Create an External Service

1. Go to **Setup → External Services**
2. Click **Add an External Service**
3. Name: `CustomerAgent_Webhook`
4. Named Credential: `CustomerAgent_Edge`
5. Service Type: **OpenAPI (REST)**
6. Schema: paste the OpenAPI spec below
7. Click **Save**

### OpenAPI Schema

```json
{
  "openapi": "3.0.0",
  "info": { "title": "CustomerAgent", "version": "1.0" },
  "paths": {
    "/webhooks/salesforce-lead-change": {
      "post": {
        "summary": "Notify CustomerAgent of a Salesforce Lead meeting time change",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "phone_e164": { "type": "string" },
                  "lead_id": { "type": "string" },
                  "meeting_time": { "type": "string" },
                  "meeting_status": { "type": "string" }
                },
                "required": ["phone_e164", "lead_id"]
              }
            }
          }
        },
        "responses": { "200": { "description": "OK" } }
      }
    }
  }
}
```

## Step 3 — Create the Record-Triggered Flow

1. Go to **Setup → Flows**
2. Click **New Flow**
3. Select **Record-Triggered Flow**
4. Configure the trigger:
   - **Object**: Lead
   - **Trigger the Flow When**: A record is updated
   - **Condition Requirements**: `Meeting_Time__c` **Is Changed** = True
5. Click **Done**

### Flow Configuration

1. **Start element**:
   - Object: Lead
   - Trigger: Updated
   - Condition: `{!$Record.Meeting_Time__c}` ISCHANGED

2. **Add Action → HTTP Callout** (or Apex Action if HTTP Callout is not available in your org):
   - External Service: `CustomerAgent_Webhook`
   - Operation: `POST /webhooks/salesforce-lead-change`
   - Body:
     ```json
     {
       "phone_e164": "{!$Record.Phone}",
       "lead_id": "{!$Record.Id}",
       "meeting_time": "{!$Record.Meeting_Time__c}",
       "meeting_status": "{!$Record.Meeting_Status__c}",
       "assigned_sdr": "{!$Record.SDR_Assigned__c}"
     }
     ```

3. **Save** the Flow as `CustomerAgent_Reschedule_Webhook`
4. **Activate** the Flow

## Alternative — Apex Trigger (if Flow HTTP Callout is unavailable)

If your Salesforce edition doesn't support HTTP Callouts in Flows, create an Apex trigger:

1. Go to **Setup → Apex Classes → New**
2. Paste:

```apex
public class CustomerAgentRescheduleTrigger {
    @future(callout=true)
    public static void sendRescheduleNotification(String phoneE164, String leadId, String meetingTime, String meetingStatus, String assignedSdr) {
        String endpoint = 'https://customer-agent-langgraph-edge-bd2578f9-6.telnyxcompute.com/webhooks/salesforce-lead-change';
        String body = JSON.new Map<String, String>{
            'phone_e164' => phoneE164,
            'lead_id' => leadId,
            'meeting_time' => meetingTime,
            'meeting_status' => meetingStatus,
            'assigned_sdr' => assignedSdr
        }.values();
        // ... HTTP POST implementation
    }
}

trigger CustomerAgentRescheduleOnLead on Lead (after update) {
    for (Lead updatedLead : Trigger.new) {
        Lead oldLead = Trigger.oldMap.get(updatedLead.Id);
        if (oldLead.Meeting_Time__c != updatedLead.Meeting_Time__c) {
            CustomerAgentRescheduleTrigger.sendRescheduleNotification(
                updatedLead.Phone,
                updatedLead.Id,
                String.valueOf(updatedLead.Meeting_Time__c),
                updatedLead.Meeting_Status__c,
                updatedLead.SDR_Assigned__c
            );
        }
    }
}
```

## Demo Curl Fallback

To simulate a Salesforce reschedule manually (for testing without the Flow):

```bash
curl -X POST \
  https://customer-agent-langgraph-edge-bd2578f9-6.telnyxcompute.com/webhooks/salesforce-lead-change \
  -H "content-type: application/json" \
  -d '{
    "phone_e164": "+14157986793",
    "lead_id": "00Qhk000000wh9oEAA",
    "meeting_time": "Thursday at 11:00 AM",
    "meeting_status": "Rescheduled by SDR",
    "assigned_sdr": "Steve"
  }'
```

Replace `00Qhk000000wh9oEAA` with the actual Lead ID from your test.

## Verification

After the Flow is configured:

1. Call the Telnyx number → schedule a meeting → reply "Yes" to AgentMail
2. Open the Lead in Salesforce
3. Change `Meeting_Time__c` to a different time
4. Save the Lead
5. The Edge function should receive the webhook
6. Anusha should receive an SMS: "Hi Anusha — your sales meeting with Steve has been moved to {new time}."
7. Check `/context?phone=+14157986793` — should show `reschedule_event` with old and new times
