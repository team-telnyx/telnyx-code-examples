# WhatsApp Order Tracking Notifications

## What Does This Example Do?

Proactive shipping updates on WhatsApp: order confirmed, shipped, out for delivery, delivered. Customers can reply anytime to check status, and AI answers questions about their orders.

## Who Is This For?

- E-commerce companies with international customers.
- Logistics teams sending delivery notifications.
- Developers building order management integrations.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. WhatsApp Business messaging + AI order intelligence on one platform. No separate notification service or chatbot provider for WhatsApp.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/whatsapp-order-tracking-notifications-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| WhatsApp | Rich notification delivery |
| Inference | AI-powered order inquiries |
| SMS | Fallback for non-WhatsApp users |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Do I need WhatsApp Business approval?**
Yes. Configure a WhatsApp Business sender via your Telnyx Messaging Profile.

**Q: Can it send tracking links?**
Yes. Include tracking URLs in the notification messages.


## Related Examples

- [Omnichannel AI Receptionist](../omnichannel-ai-receptionist-python/)
- [RCS Rich Card Product Catalog](../rcs-rich-card-product-catalog-python/)
- [Emergency Mass Notification System](../emergency-mass-notification-system-python/)
