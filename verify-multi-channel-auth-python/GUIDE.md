# Multi-Channel Phone Verification with Telnyx

Verify Multi-Channel Auth — multi-channel verification: SMS first, fallback to voice call, then WhatsApp. Cascading 2FA.

## How It Works

```
Inbound SMS ──► Webhook ──► Your App
                                │
                           Process Message
                                │
                           Reply SMS
```

## Telnyx Products Used

- **Migration**
- **Number Porting** — phone number search, purchase, and configuration
- **Verify** — phone verification with OTP delivery across channels
- **WhatsApp**

## API Endpoints

- **Create Verification**: `POST /v2/verifications` — [API reference](https://developers.telnyx.com/api/verify/create-verification)
- **Submit Verification Code**: `POST /v2/verifications/{id}/actions/verify` — [API reference](https://developers.telnyx.com/api/verify/verify-code)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/verify-multi-channel-auth-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (97 lines). Here's what each piece does.

### Starting the Workflow

**`start_verification()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    phone = data.get("phone_number")
    channel = data.get("channel", "sms")
    if not phone:
        return jsonify({"error": "phone_number required"}), 400
    try:
        resp = requests.post(f"{API}/verifications", headers=headers,
            json={"phone_number": phone, "type": channel,
```

### Business Logic

- **`check_verification()`** — Makes an API call and processes the response.
- **`escalate_channel()`** — Makes an API call and processes the response.
- **`cascade_verify()`** — Handles the cascade verify logic.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/verify/start` | Start Verification |
| `POST` | `/verify/check` | Check Verification |
| `POST` | `/verify/escalate/<vid>` | Escalate Channel |
| `POST` | `/verify/cascade` | Cascade Verify |
| `GET` | `/verifications` | List Verifications |
| `GET` | `/health` | Health check |

## Step 3: Run It

```bash
python app.py
```

Server starts on `http://localhost:5000`.

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Trigger the workflow:**

```bash
curl -X POST http://localhost:5000/verify/start \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999",
    "channel": "sms"
  }'
```

**Check results:**

```bash
curl http://localhost:5000/verifications | python3 -m json.tool
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the in-memory dict/list with PostgreSQL or Redis
- **Authentication** — add API key validation on your endpoints
- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Monitoring** — add structured logging and health check alerts
- **Rate limiting** — protect your endpoints from abuse

## Deploy

```bash
# Docker
docker build -t verify-multi-channel-auth-python .
docker run --env-file .env -p 5000:5000 verify-multi-channel-auth-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
