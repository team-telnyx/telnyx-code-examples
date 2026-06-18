# Autonomous Outbound Sales Agent

## What Does This Example Do?

A fully autonomous AI sales agent that calls leads from a queue, qualifies them through natural conversation, handles objections, books meetings, sends SMS confirmations, and logs dispositions. Feed it a list of leads, hit start, and it works through the queue independently.

## Who Is This For?

- Sales teams that need to scale outbound without hiring more BDRs.
- Growth engineers building AI-powered lead qualification pipelines.
- RevOps teams automating top-of-funnel.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform where voice, inference, and messaging run on the same network.

- **Autonomous loop** — Outbound call + AI conversation + SMS confirmation + CRM logging in a single platform. No orchestration middleware.
- **Number Lookup** — Verify numbers before calling. Skip landlines, flag invalid numbers.
- **Sub-200ms inference** — AI responses fast enough for natural phone conversation because inference runs where the call terminates.
- **One API key** — Voice, AI, and SMS with a single credential.

## Prerequisites

- Python 3.8+
- Telnyx account with API key
- Telnyx phone number enabled for outbound voice + SMS
- Connection ID for outbound calling
- [ngrok](https://ngrok.com) for webhooks

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/autonomous-outbound-sales-agent-python
cp .env.example .env
make setup && make run
```

Load leads and start:

```bash
curl -X POST http://localhost:5000/leads -H "Content-Type: application/json" \
  -d '{"leads": [{"number": "+14155551234", "name": "Jane", "company": "Acme"}]}'

curl -X POST http://localhost:5000/campaign/start
```

## Implementation Details

### The autonomous loop

```
Lead Queue → Number Lookup → Outbound Call → AI Conversation
                                                    |
                                            Qualification via Inference
                                                    |
                                         +----------+----------+
                                         |          |          |
                                     Hot Lead   Warm Lead   Cold Lead
                                         |          |          |
                                   Live Transfer  SMS Follow-up  Log & Next
                                         |
                                   SMS Confirmation
```

### Products used

| Product | Role |
|---------|------|
| Voice API | Outbound calls, speech gather, TTS |
| Inference | Conversation + lead qualification |
| Number Lookup | Pre-call validation |
| SMS | Meeting confirmations, follow-ups |

## Complete Code

See [app.py](./app.py) for the full implementation.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Calls not connecting | Verify CONNECTION_ID and FROM_NUMBER in .env |
| No speech detected | Increase end_silence_timeout_secs to 3 |
| Rate limiting | Add delay between calls in campaign loop |

## FAQ

**Q: Can this handle thousands of leads?**
Yes. Add a delay between calls and the agent works through the queue sequentially. For parallel calling, run multiple instances.

**Q: Is this compliant with TCPA?**
This example is for demonstration. Production use requires proper consent management, do-not-call list checking, and calling hour restrictions.

**Q: How does it compare to Orum or Nooks?**
Those are parallel dialers with human reps. This is a fully autonomous AI agent — no human on the line unless the lead qualifies for transfer.

## Resources

- [Voice API](https://developers.telnyx.com/docs/voice)
- [Number Lookup](https://developers.telnyx.com/docs/numbers/number-lookup)
- [Inference](https://developers.telnyx.com/docs/inference)
- [Messaging](https://developers.telnyx.com/docs/messaging)

## Related Examples

- [AI Sales Call with Live CRM Updates](../ai-sales-call-with-live-crm-updates-python/)
- [Global Lead Response Engine](../global-lead-response-engine-python/)
- [Build a Voice AI Agent](../build-voice-ai-agent-python/)
