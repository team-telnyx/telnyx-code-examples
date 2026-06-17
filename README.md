# Telnyx Code Examples — AI Communications Infrastructure

Production-ready, deployable code examples for the Telnyx platform. Each example is a self-contained project with a Dockerfile, Makefile, and environment configuration — clone, configure, and run in minutes.

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples

# 2. Pick an example
cd send-sms-python

# 3. Configure and run
cp .env.example .env
# Edit .env with your Telnyx API key from https://portal.telnyx.com
make setup && make run
```

> Full API reference at [developers.telnyx.com](https://developers.telnyx.com)

Every example supports three deployment options: **Local** (`make setup && make run`), **Docker** (`make docker-build && make docker-run`), and **Manual** (step-by-step instructions in each README).

---

## Voice AI

Build voice applications with [Telnyx Voice AI](https://telnyx.com/products/voice-ai-agents) — IVR menus, call recording, conferencing, WebRTC, and AI-powered call routing.

| Example | Language | Description |
|---------|----------|-------------|
| [route-phone-calls-to-ai-agent-python](./route-phone-calls-to-ai-agent-python/) | Python | Handle inbound calls with webhook-driven AI routing. |
| [make-outbound-phone-call-python](./make-outbound-phone-call-python/) | Python | Initiate outbound calls via the Call Control API. |
| [build-ivr-phone-menu-python](./build-ivr-phone-menu-python/) | Python | Build an interactive voice response menu with DTMF input. |
| [record-phone-calls-python](./record-phone-calls-python/) | Python | Record calls and receive recording webhooks. |
| [transfer-live-phone-calls-python](./transfer-live-phone-calls-python/) | Python | Transfer active calls to another number or agent. |
| [text-to-speech-phone-call-python](./text-to-speech-phone-call-python/) | Python | Play text-to-speech audio during a phone call. |
| [build-conference-calling-python](./build-conference-calling-python/) | Python | Create multi-party conference calls. |
| [call-whisper-monitoring-python](./call-whisper-monitoring-python/) | Python | Monitor calls with whisper prompts for agents. |
| [call-forwarding-python](./call-forwarding-python/) | Python | Forward incoming calls to another destination. |
| [webrtc-browser-calling-python](./webrtc-browser-calling-python/) | Python | Enable browser-based calling with WebRTC. |
| [route-phone-calls-to-ai-agent-nodejs](./route-phone-calls-to-ai-agent-nodejs/) | Node.js | Handle inbound calls with webhook-driven AI routing. |
| [make-outbound-phone-call-nodejs](./make-outbound-phone-call-nodejs/) | Node.js | Initiate outbound calls via the Call Control API. |
| [build-ivr-phone-menu-nodejs](./build-ivr-phone-menu-nodejs/) | Node.js | Build an interactive voice response menu with DTMF input. |
| [record-phone-calls-nodejs](./record-phone-calls-nodejs/) | Node.js | Record calls and receive recording webhooks. |
| [text-to-speech-phone-call-nodejs](./text-to-speech-phone-call-nodejs/) | Node.js | Play text-to-speech audio during a phone call. |
| [route-phone-calls-to-ai-agent-go](./route-phone-calls-to-ai-agent-go/) | Go | Handle inbound calls with webhook-driven AI routing. |

## SMS & MMS

Send and receive text messages with the [Telnyx SMS API](https://telnyx.com/products/sms-api) — build autoresponders, implement 2FA, and manage bulk messaging campaigns.

| Example | Language | Description |
|---------|----------|-------------|
| [send-sms-python](./send-sms-python/) | Python | Send a single SMS message via the Telnyx API. |
| [receive-sms-webhook-python](./receive-sms-webhook-python/) | Python | Receive inbound SMS via webhook. |
| [send-bulk-sms-python](./send-bulk-sms-python/) | Python | Send SMS messages to multiple recipients. |
| [sms-two-factor-auth-python](./sms-two-factor-auth-python/) | Python | Implement SMS-based two-factor authentication. |
| [send-mms-picture-message-python](./send-mms-picture-message-python/) | Python | Send MMS messages with media attachments. |
| [sms-auto-reply-bot-python](./sms-auto-reply-bot-python/) | Python | Build an SMS autoresponder bot. |
| [send-sms-nodejs](./send-sms-nodejs/) | Node.js | Send a single SMS message via the Telnyx API. |
| [receive-sms-webhook-nodejs](./receive-sms-webhook-nodejs/) | Node.js | Receive inbound SMS via webhook. |
| [sms-two-factor-auth-nodejs](./sms-two-factor-auth-nodejs/) | Node.js | Implement SMS-based two-factor authentication. |
| [send-bulk-sms-nodejs](./send-bulk-sms-nodejs/) | Node.js | Send SMS messages to multiple recipients. |
| [send-sms-go](./send-sms-go/) | Go | Send a single SMS message via the Telnyx API. |
| [send-sms-ruby](./send-sms-ruby/) | Ruby | Send a single SMS message via the Telnyx API. |

## AI Assistants

Create, manage, and chat with [Telnyx AI Assistants](https://telnyx.com/ai-assistants) — LLM-powered agents for voice and messaging automation.

| Example | Language | Description |
|---------|----------|-------------|
| [create-ai-assistant-python](./create-ai-assistant-python/) | Python | Create a new AI assistant with custom instructions. |
| [chat-with-ai-assistant-python](./chat-with-ai-assistant-python/) | Python | Send messages to an AI assistant and receive responses. |
| [list-ai-assistants-python](./list-ai-assistants-python/) | Python | List and manage your AI assistants. |
| [clone-ai-assistant-python](./clone-ai-assistant-python/) | Python | Clone an existing AI assistant configuration. |
| [update-ai-assistant-python](./update-ai-assistant-python/) | Python | Update an AI assistant's instructions and settings. |
| [create-ai-assistant-nodejs](./create-ai-assistant-nodejs/) | Node.js | Create a new AI assistant with custom instructions. |
| [chat-with-ai-assistant-nodejs](./chat-with-ai-assistant-nodejs/) | Node.js | Send messages to an AI assistant and receive responses. |
| [list-ai-assistants-nodejs](./list-ai-assistants-nodejs/) | Node.js | List and manage your AI assistants. |

## SIP Trunking

Connect your PBX or SBC to [Telnyx SIP Trunking](https://telnyx.com/products/sip-trunks) — trunk setup, inbound routing, failover, and codec configuration.

| Example | Language | Description |
|---------|----------|-------------|
| [setup-sip-trunk-python](./setup-sip-trunk-python/) | Python | Set up a SIP trunk connection with Telnyx. |
| [inbound-sip-routing-python](./inbound-sip-routing-python/) | Python | Route inbound SIP calls to your endpoints. |
| [sip-failover-routing-python](./sip-failover-routing-python/) | Python | Configure failover routing for SIP connections. |
| [configure-sip-codecs-python](./configure-sip-codecs-python/) | Python | Configure audio codecs for SIP trunks. |
| [setup-sip-trunk-nodejs](./setup-sip-trunk-nodejs/) | Node.js | Set up a SIP trunk connection with Telnyx. |
| [inbound-sip-routing-nodejs](./inbound-sip-routing-nodejs/) | Node.js | Route inbound SIP calls to your endpoints. |
| [setup-sip-trunk-go](./setup-sip-trunk-go/) | Go | Set up a SIP trunk connection with Telnyx. |

## IoT & SIM Management

Activate SIM cards, monitor data usage, provision eSIMs, and track device locations with the [Telnyx IoT platform](https://telnyx.com/products/iot-sim-card).

| Example | Language | Description |
|---------|----------|-------------|
| [activate-sim-card-python](./activate-sim-card-python/) | Python | Activate a SIM card on the Telnyx network. |
| [monitor-iot-data-usage-python](./monitor-iot-data-usage-python/) | Python | Monitor data usage for IoT SIM cards. |
| [provision-esim-python](./provision-esim-python/) | Python | Provision eSIM profiles over the air. |
| [track-iot-device-location-python](./track-iot-device-location-python/) | Python | Track the geographic location of IoT devices. |
| [activate-sim-card-nodejs](./activate-sim-card-nodejs/) | Node.js | Activate a SIM card on the Telnyx network. |
| [monitor-iot-data-usage-nodejs](./monitor-iot-data-usage-nodejs/) | Node.js | Monitor data usage for IoT SIM cards. |
| [activate-sim-card-go](./activate-sim-card-go/) | Go | Activate a SIM card on the Telnyx network. |

---

## What Is Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that provides a single, integrated API for:

- **[Voice AI](https://telnyx.com/products/voice-ai-agents)** — Programmable voice with Call Control, IVR, recording, conferencing, and WebRTC.
- **[SMS & MMS](https://telnyx.com/products/sms-api)** — Send and receive messages globally with delivery receipts and webhook events.
- **[SIP Trunking](https://telnyx.com/products/sip-trunks)** — Connect your existing PBX with elastic SIP trunks, failover routing, and codec control.
- **[AI Assistants](https://telnyx.com/ai-assistants)** — Deploy LLM-powered voice and messaging agents with built-in telephony.
- **[IoT & SIM](https://telnyx.com/products/iot-sim-card)** — Global IoT connectivity with SIM management, eSIM provisioning, and data monitoring.

Unlike stitching together multiple vendors into a Frankenstack, Telnyx gives you one platform, one API key, and one bill. Calls and messages traverse the Telnyx-owned private IP network for lower latency and higher reliability.

## How to Get a Telnyx API Key

1. Sign up at [portal.telnyx.com](https://portal.telnyx.com).
2. Navigate to **API Keys** in the left sidebar.
3. Click **Create API Key** and copy the key.
4. Add it to your `.env` file as `TELNYX_API_KEY=your_key_here`.

Telnyx offers free trial credit for testing.

## FAQ

**Q: What programming languages are supported?**

These examples cover Python, Node.js, Go, and Ruby. Telnyx also provides official SDKs for Java, PHP, and C#.

**Q: Are these examples production-ready?**

Yes. Every example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review security and scaling considerations before deploying to production.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network. It offers integrated voice, messaging, AI, SIP, and IoT under one API — no need to stitch together multiple vendors. Telnyx also offers significantly lower pricing with no per-seat fees or contracts.

**Q: Do I need multiple vendors for voice, SMS, and AI?**

No. Telnyx provides voice, SMS/MMS, SIP trunking, AI assistants, and IoT SIM management through a single platform and API key.

**Q: Can I use these examples with my existing PBX?**

Yes. The SIP trunking examples show how to connect Telnyx to Asterisk, FreeSWITCH, 3CX, and other PBX systems.

**Q: Is there a free tier?**

Telnyx provides trial credit when you sign up. After that, pricing is pay-as-you-go with no minimums or contracts.

**Q: How do I get help?**

Check the Troubleshooting section in each example, visit [developers.telnyx.com](https://developers.telnyx.com), or reach out to [support@telnyx.com](mailto:support@telnyx.com).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on adding new examples.

## License

[MIT](./LICENSE)
