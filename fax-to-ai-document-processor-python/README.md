# Fax to AI Document Processor

## What Does This Example Do?

Receive faxes on a Telnyx number, AI classifies the document type (invoice, contract, medical form, etc.), extracts key fields, assigns priority, and sends urgent fax alerts via SMS.

## Who Is This For?

- Healthcare offices still receiving faxed prescriptions and referrals.
- Legal firms processing faxed documents.
- Any business modernizing fax workflows with AI.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. Fax reception + AI document intelligence + SMS alerting without a separate fax service, OCR provider, or document management system.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/fax-to-ai-document-processor-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Fax API | Fax reception |
| Inference | Document classification and data extraction |
| SMS | Urgent fax alerts |
| Cloud Storage | Document archival |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Can it read handwritten faxes?**
The AI classifies based on available metadata. For handwritten content, add a vision model for OCR.

**Q: Why is fax still relevant?**
Healthcare, legal, and government still rely on fax for compliance. This modernizes the workflow without eliminating the channel.


## Related Examples

- [Compliance Call Recorder AI Auditor](../compliance-call-recorder-ai-auditor-python/)
- [AI Insurance Claims Intake Voice](../ai-insurance-claims-intake-voice-python/)
