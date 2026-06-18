# RCS Rich Card Product Catalog

## What Does This Example Do?

An AI-powered product recommendation engine over RCS messaging. Customers text what they need, AI matches them to products, and sends rich cards with images, pricing, and action buttons.

## Who Is This For?

- E-commerce teams wanting rich mobile product discovery.
- Retailers building conversational commerce.
- Developers exploring RCS capabilities.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. RCS rich cards + AI recommendations on one messaging platform. No separate chatbot builder or product recommendation engine.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/rcs-rich-card-product-catalog-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| RCS | Rich card messaging with action buttons |
| SMS | Fallback for non-RCS devices |
| Inference | Product matching and recommendations |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: What if the customer's phone doesn't support RCS?**
Falls back to standard SMS with text-based product descriptions.

**Q: Can I connect my real product database?**
Yes. Replace the PRODUCT_CATALOG list with your database or API calls.


## Related Examples

- [Whatsapp Order Tracking Notifications](../whatsapp-order-tracking-notifications-python/)
- [SMS Chatbot With Conversation Memory](../sms-chatbot-with-conversation-memory-python/)
- [Messaging Campaign Ab Test Optimizer](../messaging-campaign-ab-test-optimizer-python/)
