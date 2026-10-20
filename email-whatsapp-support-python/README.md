# Customer Support Across Email & WhatsApp

A unified dashboard demo showing customer support across Email and WhatsApp channels using [Telnyx](https://telnyx.com) APIs.

**Scenario**: A customer reports a damaged order via email. Support follows up on WhatsApp to collect a damage photo, approves a replacement, and sends a shipping confirmation back via email — all tracked in a single dashboard.

## Why Telnyx

One API surface covers both channels: the Telnyx Email API sends and receives the thread with delivery events, while the WhatsApp Business API (via Telnyx messaging profiles) handles the template message, inbound photo, and chat session — with a single account, single set of credentials, and a single webhook convention across both. This is **AI Communications Infrastructure**: channel-agnostic messaging primitives you compose into support workflows, rather than stitching together separate vendors per channel.

## Quick Start (Demo Mode)

No Telnyx credentials needed:

```bash
pip install -r requirements.txt
python demo/demo_server.py
```

Open http://localhost:5050 and click **Run Demo Journey**.

## What You'll See

The dashboard has four panels:

| Panel | Content |
|-------|---------|
| **Customer** | Profile card with name, email, phone |
| **Email Thread** | Subject/body cards with inbound (blue) / outbound (green) borders |
| **WhatsApp** | Phone-frame UI with chat bubbles, delivery ticks, image thumbnails |
| **Order & Timeline** | Order status badge transitions, damage photo, chronological event log |

### Demo Journey (5 Steps)

| Step | Channel | Direction | What Happens |
|------|---------|-----------|--------------|
| 1a | Email | Inbound | Customer reports damaged headphones |
| 1b | Email | Outbound | Auto-acknowledgment, mentions WhatsApp follow-up |
| 2 | WhatsApp | Outbound | Template message requesting damage photo |
| 3 | WhatsApp | Inbound | Customer sends photo + description |
| 4 | WhatsApp | Outbound | Support confirms replacement approved |
| 5 | Email | Outbound | Shipping confirmation with tracking number |

Order status transitions: `delivered` → `damage_reported` → `replacement_shipping` → `resolved`

## Live Mode

To run with real Telnyx credentials:

```bash
cp .env.example .env
# Edit .env with your credentials
python app.py
```

Configure Telnyx webhooks:
- **Email**: `https://your-domain.com/webhooks/email`
- **WhatsApp**: `https://your-domain.com/webhooks/whatsapp`

## Project Structure

```
email-whatsapp-support-python/
├── app.py                  # Flask app: webhooks, channel helpers, SSE, customer registry
├── demo/
│   └── demo_server.py      # Imports app.py, mocks APIs, runs scripted journey
├── templates/
│   └── index.html          # Dashboard UI (4-panel layout)
├── requirements.txt        # flask, python-dotenv, telnyx, requests
├── .env.example            # Credential placeholders
├── smoke_test.py           # Basic tests
├── README.md               # This file
├── API.md                  # Endpoint reference
└── GUIDE.md                # Tutorial walkthrough
```

## API Endpoints

See [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/email-whatsapp-support-python/API.md) for the full endpoint reference.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Dashboard UI |
| `/health` | GET | Status + mode |
| `/customers` | GET | List customers |
| `/conversations` | GET | Conversation history |
| `/orders` | GET | Order state |
| `/stream` | GET | SSE event stream |
| `/webhooks/email` | POST | Email webhook |
| `/webhooks/whatsapp` | POST | WhatsApp webhook |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Dashboard shows demo data only | Running `demo/demo_server.py` | Demo mode mocks the APIs; set `.env` credentials and run `python app.py` for live mode |
| `401` on send | Missing/wrong `TELNYX_API_KEY` | Re-check `.env`; the key needs messaging + email scopes |
| No inbound webhooks | Webhook URLs not configured or unreachable | Point the Telnyx email/WhatsApp webhooks at your public URL (`/webhooks/email`, `/webhooks/whatsapp`) |
| Webhook payloads rejected | Signature verification failure | Ensure the Telnyx Ed25519 public key is set (`TELNYX_PUBLIC_KEY`) |
| WhatsApp template not sending | Template not approved on the WhatsApp Business app | Approve the template in the Meta portal, then resend |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub Repository](https://github.com/team-telnyx/ai)
- [Telnyx llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- **Email API Quickstart** — send and track transactional email with Telnyx.
- **WhatsApp Business API** — order tracking and notifications over WhatsApp.
- **Webhook Aggregator with Fanout** — route Telnyx webhooks to multiple consumers.

## Tests

```bash
python smoke_test.py
```
