# Global Lead Response Engine

## What Does This Example Do?

Inbound calls from any country are auto-detected for language and region via Number Lookup. The AI greets the caller in their language, qualifies them through conversation, then routes: hot leads get live-transferred to the nearest AE via SIP trunking, warm leads receive WhatsApp follow-up, cold leads get an SMS with self-serve links. All logged to CRM. Sub-3-second response time because everything is on-net.

## Who Is This For?

- Global sales teams handling inbound leads from multiple countries.
- Growth engineers building automated lead routing and qualification.
- Companies expanding internationally that need multilingual AI.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform with a global private network in 60+ countries.

- **Global numbers** — Local phone numbers in 140+ countries. Prospects call a local number, AI answers.
- **Auto language detection** — Number Lookup identifies country. AI greets and qualifies in the right language.
- **Multi-channel follow-up** — SMS for domestic, WhatsApp for international. Same API.
- **SIP trunking** — Hot leads transferred to AEs via global SIP infrastructure. No PSTN hairpinning.

## Prerequisites

- Python 3.8+
- Telnyx account with API key
- Telnyx phone numbers in target countries
- Messaging Profile for SMS/WhatsApp
- AE phone numbers for live transfer

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/global-lead-response-engine-python
cp .env.example .env
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| Global Numbers | Local numbers in target countries |
| Number Lookup | Country and carrier detection |
| Voice API | Multilingual call handling |
| Inference | Lead qualification |
| SMS | Domestic follow-ups |
| WhatsApp | International follow-ups |
| SIP Trunking | Live transfer to AEs |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: Which languages are supported?**
This example includes English, Spanish, Portuguese, French, German, and Japanese. Telnyx supports 20+ languages for STT/TTS.

**Q: How fast is the qualification?**
The AI qualifies after 3 conversational exchanges — typically under 2 minutes.

**Q: Can I add more countries?**
Yes. Add entries to the LANGUAGE_MAP dictionary and purchase local numbers via the Telnyx Numbers API.

## Resources

- [Global Numbers](https://developers.telnyx.com/docs/numbers)
- [Number Lookup](https://developers.telnyx.com/docs/numbers/number-lookup)
- [Voice API](https://developers.telnyx.com/docs/voice)
- [WhatsApp](https://developers.telnyx.com/docs/messaging/whatsapp)

## Related Examples

- [Autonomous Outbound Sales Agent](../autonomous-outbound-sales-agent-python/)
- [Omnichannel AI Receptionist](../omnichannel-ai-receptionist-python/)
- [AI Sales Call with Live CRM Updates](../ai-sales-call-with-live-crm-updates-python/)
