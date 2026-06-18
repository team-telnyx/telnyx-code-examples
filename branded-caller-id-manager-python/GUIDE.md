# Build a Branded Caller ID Manager

Branded Caller ID Manager — register, manage, and verify branded calling profiles with STIR/SHAKEN attestation for higher answer rates.

## How It Works

```
Inbound SMS ──► Webhook ──► Your App
                                │
                           Process Message
                                │
                           Reply SMS
```

## Telnyx Products Used

- **Branded Calling** — programmatic call control with webhooks for every call state change
- **CNAM Lookup**
- **Migration**
- **Number Porting** — phone number search, purchase, and configuration
- **Verify** — phone verification with OTP delivery across channels

## API Endpoints

- **Update Number**: `PATCH /v2/phone_numbers/{id}` — [API reference](https://developers.telnyx.com/api/numbers/update-phone-number)
- **CNAM Listing**: `POST /v2/cnam_requests` — [API reference](https://developers.telnyx.com/api/cnam/create-cnam-request)
- **Number Lookup**: `GET /v2/number_lookup/{phone_number}` — [API reference](https://developers.telnyx.com/api/number-lookup/lookup-number)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with voice enabled
- [Call Control Application](https://portal.telnyx.com/call-control/applications) configured with your webhook URL
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/branded-caller-id-manager-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` with your Telnyx credentials. Each variable links to where you find it in the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `app.py` (91 lines). Here's what each piece does.

### Starting the Workflow

**`create_brand()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    try:
        resp = requests.post(f"{API}/brand", headers=headers,
            json={"entity_type": data.get("entity_type", "PRIVATE_PROFIT"),
                "display_name": data.get("display_name"),
                "company_name": data.get("company_name"),
                "ein": data.get("ein"), "phone": data.get("phone"),
                "street": data.get("street"), "city": data.get("city"),
```

**`create_campaign()`** — Kicks off the main workflow. Validates the request, creates the record, and initiates the Telnyx API calls.

```python
data = request.get_json()
    try:
        resp = requests.post(f"{API}/phoneNumberCampaign", headers=headers,
            json={"telnyx_brand_id": data.get("brand_id"),
                "usecase": data.get("usecase", "MIXED"),
                "description": data.get("description"),
                "sample_message": data.get("sample_message", ["Your appointment is tomorrow at 2pm. Reply CONFIRM."]),
                "phone_numbers": data.get("phone_numbers", [])}, timeout=15)
```

### Business Logic

- **`list_brands()`** — Makes an API call and processes the response.
- **`update_caller_id()`** — Handles the update caller id logic.
- **`stir_shaken_status()`** — Makes an API call and processes the response.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/brands` | Create Brand |
| `POST` | `/brands` | List Brands |
| `POST` | `/campaigns` | Create Campaign |
| `PUT` | `/numbers/<number>/caller-id` | Update Caller Id |
| `GET` | `/stir-shaken/status` | Stir Shaken Status |
| `POST` | `/campaigns` | List Campaigns |
| `GET` | `/health` | Health check |

## Step 3: Run It

```bash
python app.py
```

Server starts on `http://localhost:5000`.

In a separate terminal, expose your server for webhooks:

```bash
ngrok http 5000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/voice`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Trigger the workflow:**

```bash
curl -X POST http://localhost:5000/brands \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125559999"
  }'
```

Or call your Telnyx number from any phone to trigger the full voice workflow.

**Check results:**

```bash
curl http://localhost:5000/stir-shaken/status | python3 -m json.tool
```

## Going to Production

This example uses in-memory storage for simplicity. For production:

- **Database** — replace the in-memory dict/list with PostgreSQL or Redis
- **Authentication** — add API key validation on your endpoints
- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Error recovery** — handle call failures gracefully with retry or SMS fallback
- **Monitoring** — add structured logging and health check alerts
- **Rate limiting** — protect your endpoints from abuse

## Deploy

```bash
# Docker
docker build -t branded-caller-id-manager-python .
docker run --env-file .env -p 5000:5000 branded-caller-id-manager-python

# Or Makefile
make setup && make run
```

## Resources

- [Source code and reference](./README.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control quickstart](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Portal](https://portal.telnyx.com)
