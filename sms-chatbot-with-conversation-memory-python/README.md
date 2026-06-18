# SMS Chatbot with Conversation Memory

## What Does This Example Do?

A persistent AI chatbot over SMS. It remembers everything you've told it across messages — your preferences, past questions, context from weeks ago. Automatically summarizes old messages to stay within context limits.

## Who Is This For?

- Businesses wanting an AI text assistant for customers.
- Developers building conversational SMS experiences.
- Anyone who wants a personal AI assistant via text message.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform. SMS delivery + AI inference on one platform. No message broker, no separate LLM provider, no conversation database — memory managed in-process with intelligent summarization.

## Prerequisites

- Python 3.8+
- Telnyx account with API key from [portal.telnyx.com](https://portal.telnyx.com)
- [ngrok](https://ngrok.com) for local development

## Quick Start

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-chatbot-with-conversation-memory-python
cp .env.example .env
# Edit .env with your credentials
make setup && make run
```

## Implementation Details

### Products used

| Product | Role |
|---------|------|
| SMS | Two-way text messaging |
| Inference | Conversational AI with memory |

## Complete Code

See [app.py](./app.py) for the full implementation.

## FAQ

**Q: How long does it remember?**
Forever in this demo (in-memory). For production, swap the dictionary for Redis or Postgres.

**Q: Can it handle group texts?**
This handles 1:1 conversations. For group, add participant tracking per thread.


## Related Examples

- [Omnichannel AI Receptionist](../omnichannel-ai-receptionist-python/)
- [MMS Receipt Scanner Expense Tracker](../mms-receipt-scanner-expense-tracker-python/)
- [Multi Channel AI Helpdesk With Ticketing](../multi-channel-ai-helpdesk-with-ticketing-python/)
