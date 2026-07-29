# Build A HIPAA-Compliant Lab Results Voice Assistant

This guide walks through the direct Telnyx AI Assistant flow for the lab results assistant.

## Flow

1. The patient calls a Telnyx number.
2. Telnyx starts the configured AI Assistant directly from the phone-number assignment.
3. The assistant asks for full legal name and date of birth.
4. The assistant verifies the caller against mock records in the prompt.
5. Results are summarized in minimum-necessary plain language.
6. SMS links are sent only when requested and never include lab values.
7. Abnormal results are routed to nurse callback language.

## Local Test Data

Use one of these mock patients:

| Name | Date of birth | Latest result |
|---|---|---|
| Jordan Lee | 1990-03-15 | abnormal hemoglobin a1c |
| Maya Rivera | 1984-11-22 | normal complete blood count |
| Sam Patel | 1978-07-09 | borderline thyroid panel |

## Provision

```bash
python provision_assistant.py
```

Assign your Telnyx phone number directly to the assistant in the Telnyx Portal. No tunnel is required for the direct demo path.

## Optional Local Backend

`app.py` contains optional Flask endpoints for teams that want backend verification, result lookup, audit events, and escalation routing.

```bash
python app.py
```

If you use those endpoints with Telnyx webhooks, expose the app with a public HTTPS URL and configure webhook signature verification.

## Verify Optional Endpoints

```bash
curl -X POST http://localhost:5000/tools/verify_patient_identity \
  -H "Content-Type: application/json" \
  -H "X-Lab-Results-Tool-Secret: $TOOL_SECRET" \
  -d '{"full_name":"maya rivera","date_of_birth":"1984-11-22","caller_phone":"+15555550101"}'
```

```bash
curl -X POST http://localhost:5000/tools/get_latest_lab_result \
  -H "Content-Type: application/json" \
  -H "X-Lab-Results-Tool-Secret: $TOOL_SECRET" \
  -d '{"patient_id":"pat_1002"}'
```

## HIPAA Compliance Focus

The sample keeps the assistant from reading results until identity verification succeeds. It also avoids sending lab values over SMS, masks identifiers in operational state, and records compact audit events instead of raw call transcripts.
