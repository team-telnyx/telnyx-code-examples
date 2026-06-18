# Omnichannel AI Receptionist

## What Does This Example Do?

One AI brain that handles voice calls, SMS, and WhatsApp with shared context across channels. A customer who calls about a refund and then texts "any update?" gets a relevant response because the AI remembers the previous call. Books appointments, answers FAQs, transfers to humans, sends MMS with directions.

## Who Is This For?

- Small businesses that need a 24/7 receptionist without staffing costs.
- Developers building unified AI customer service across channels.
- Enterprises consolidating voice + messaging into a single AI layer.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform with voice, SMS, MMS, and WhatsApp on the same network.

- **True omnichannel** — Voice, SMS, and WhatsApp from a single API key with shared phone numbers.
- **Cross-channel memory** — Same conversation history regardless of how the customer reaches you.
- **One platform** — No Twilio for SMS + Vonage for WhatsApp + another vendor for voice. One integration, one bill.

## Prerequisites

- Python 3.8+
- Telnyx account with API key
- Telnyx phone number with voice + messaging enabled
- Messaging Profile configured for SMS/WhatsApp
- [ngrok](https://ngrok.com) for webhooks

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/omnichannel-ai-receptionist-python
cp .env.example .env
make setup && make run
```

## Implementation Details

### Shared context architecture

```
     Voice Call          SMS            WhatsApp
         |                |                |
         v                v                v
    /webhooks/voice  /webhooks/messaging  /webhooks/messaging
         |                |                |
         +-------+--------+--------+------+
                 |                  |
          Customer Context Store (shared)
                 |
          Telnyx Inference (same conversation)
                 |
          Response via original channel
```

### Products used

| Product | Role |
|---------|------|
| Voice API | Inbound calls, speech, TTS |
| SMS/MMS | Text conversations, image responses |
| WhatsApp | WhatsApp Business messaging |
| Inference | Unified AI conversation |

## Complete Code

See [app.py](./app.py) for the full implementation.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| SMS not routing | Check Messaging Profile ID and webhook URL |
| WhatsApp messages not arriving | Verify WhatsApp Business is enabled on your Messaging Profile |
| No cross-channel memory | Ensure customer phone number format is consistent (E.164) |

## FAQ

**Q: Does it remember conversations across days?**
In this example, memory is in-process. For production, swap the dictionary for Redis or a database.

**Q: Can I add webchat?**
Yes. Add a `/webhooks/chat` endpoint that feeds into the same customer context store.

**Q: How many channels can one phone number handle?**
A Telnyx number with voice + messaging enabled handles calls and texts simultaneously.

## Resources

- [Voice API](https://developers.telnyx.com/docs/voice)
- [Messaging API](https://developers.telnyx.com/docs/messaging)
- [WhatsApp](https://developers.telnyx.com/docs/messaging/whatsapp)
- [Inference](https://developers.telnyx.com/docs/inference)

## Related Examples

- [Build a Voice AI Agent](../build-voice-ai-agent-python/)
- [Global Lead Response Engine](../global-lead-response-engine-python/)
- [AI-Powered IVR Replacement](../ai-powered-ivr-replacement-python/)
