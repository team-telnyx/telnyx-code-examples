# Compliance Call Recorder + AI Auditor

## What Does This Example Do?

Every outbound sales call is automatically recorded and stored in Telnyx Cloud Storage. After each call, AI processes the transcript to verify required disclosures were made, detects compliance violations, generates risk scores per rep, and creates tickets for violations. A compliance dashboard shows rates by rep and recent violations.

## Who Is This For?

- Compliance officers monitoring outbound sales teams.
- Contact center operators with regulatory recording requirements.
- Legal teams building automated audit trails.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Recording, storage, transcription, and inference on one network.

- **Recording + Storage** — Dual-channel recording stored directly in Telnyx Cloud Storage. No S3 configuration, no third-party recording vendor.
- **On-network transcription** — Audio transcribed on the same infrastructure. Never leaves the Telnyx network.
- **AI audit** — Inference analyzes every call against your compliance checklist. Not sampling — every call.
- **Ticket automation** — Violations automatically create tickets via webhook to ServiceNow, Jira, or any system.

## Prerequisites

- Python 3.8+
- Telnyx account with API key
- Telnyx Cloud Storage bucket
- Ticketing webhook (optional — ServiceNow, Jira, etc.)

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/compliance-call-recorder-ai-auditor-python
cp .env.example .env
make setup && make run
```

View audit results: `http://localhost:5000/audit/results`

## Implementation Details

### Audit pipeline

```
Outbound Call → Auto-Record (dual-channel MP3)
                    |
              Real-time Transcription
                    |
              Call Ends → Recording Saved to Cloud Storage
                    |
              AI Compliance Audit (Telnyx Inference)
                    |
              +-----+-----+
              |           |
          Compliant    Violation Detected
              |           |
          Log result   Create Ticket + Alert
```

### Products used

| Product | Role |
|---------|------|
| Voice API | Recording, transcription |
| Cloud Storage | Recording archival |
| Inference | Compliance analysis |
| Webhooks | Ticket creation |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can I customize the compliance checklist?**
Yes. Edit the REQUIRED_DISCLOSURES list in app.py to match your regulatory requirements.

**Q: Is this a replacement for manual QA?**
It augments QA by auditing 100% of calls. Use it to flag calls for human review rather than replacing human judgment entirely.

**Q: What about call recording consent?**
This example includes a "recording disclosure" check. Configure your compliance rules according to your jurisdiction (one-party vs two-party consent states).

## Resources

- [Voice API](https://developers.telnyx.com/docs/voice)
- [Cloud Storage](https://developers.telnyx.com/docs/storage)
- [Inference](https://developers.telnyx.com/docs/inference)

## Related Examples

- [Real-Time Call Intelligence Dashboard](../real-time-call-intelligence-dashboard-python/)
- [AI Sales Call with Live CRM Updates](../ai-sales-call-with-live-crm-updates-python/)
- [Voice-Verified Identity + 2FA](../voice-verified-identity-2fa-python/)
