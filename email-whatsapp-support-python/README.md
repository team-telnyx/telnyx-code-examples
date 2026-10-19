# Customer Support Across Email & WhatsApp

A unified dashboard demo showing customer support across Email and WhatsApp channels using [Telnyx](https://telnyx.com) APIs.

**Scenario**: A customer reports a damaged order via email. Support follows up on WhatsApp to collect a damage photo, approves a replacement, and sends a shipping confirmation back via email — all tracked in a single dashboard.

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

## Tests

```bash
python smoke_test.py
```
