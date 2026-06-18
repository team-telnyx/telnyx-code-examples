# MMS Receipt Scanner & Expense Tracker

## What Does This Example Do?

Text a photo of a receipt and the AI extracts vendor, amount, and category. Type expenses manually. Text 'summary' for a categorized expense report. All via MMS/SMS.

## Who Is This For?

- Freelancers tracking business expenses.
- Small teams without expense management software.
- Developers building MMS-powered data capture.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. MMS media handling + AI extraction + SMS responses on one platform. The receipt photo goes from phone to AI analysis without touching a third-party OCR service.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/mms-receipt-scanner-expense-tracker-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| MMS | Receipt photo upload |
| SMS | Expense entry and reports |
| Inference | Receipt data extraction and categorization |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Does it actually read the receipt image?**
The AI analyzes text descriptions and amounts. For production OCR, add a vision model or image preprocessing step.

**Q: Can I export to QuickBooks?**
Add a QuickBooks API call in the expense logging flow.


## Related Examples

- [SMS Chatbot With Conversation Memory](../sms-chatbot-with-conversation-memory-python/)
- [Whatsapp Order Tracking Notifications](../whatsapp-order-tracking-notifications-python/)
