# Look Up Phone Number Data with Telnyx

Build a Flask service that returns carrier, line type, and portability data for any phone number using the Telnyx Number Lookup API — with a 24-hour cache so repeat lookups are free and fast.

## How It Works

```
  HTTP Request (POST /lookup or GET /lookup/<number>)
        │
        ▼
  ┌──────────────────┐      hit
  │  In-memory cache  │──────────────► cached result (from_cache: true)
  │   (24h TTL)       │
  └────────┬─────────┘
           │ miss
           ▼
  ┌──────────────────┐
  │  Telnyx Number    │
  │  Lookup API       │
  └────────┬─────────┘
           │
           └──► carrier + line type + portability (cached, returned)
```

## Telnyx Products Used

- **Number Lookup** — authoritative carrier, line type, and portability data for any number

## API Endpoints

- **Number Lookup**: `GET /v2/number_lookup/{phone_number}` -- [API reference](https://developers.telnyx.com/api-reference/number-lookup/retrieve-lookup)

## Prerequisites

- Python 3.8+
- [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance
- [API key](https://portal.telnyx.com/api-keys)
- curl or Postman to test the endpoints

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/phone-number-lookup-python
cp .env.example .env
pip install -r requirements.txt
```

Edit `.env` and set your `TELNYX_API_KEY` from the [Telnyx Portal](https://portal.telnyx.com/api-keys).

## Step 2: Understand the Code

Everything lives in `app.py`. Here's what each piece does.

### Client Initialization

The Telnyx client is created once at startup from the API key in the environment:

```python
client = telnyx.Telnyx(api_key=os.getenv("TELNYX_API_KEY"))
```

### The Lookup Function

`lookup_phone_number()` validates the number, checks the cache, calls the Telnyx Number Lookup API on a miss, and reshapes the SDK response into a flat, JSON-serializable dict:

```python
def lookup_phone_number(phone_number: str) -> dict:
    # Validate E.164 format
    if not phone_number.startswith("+"):
        raise ValueError("Phone number must be in E.164 format (e.g., +15551234567)")

    # Check cache first
    cached_result = get_cached_lookup(phone_number)
    if cached_result:
        cached_result["from_cache"] = True
        return cached_result

    # Call Telnyx Number Lookup API
    response = client.number_lookup.retrieve(phone_number)
    ...
```

### Caching

A simple in-memory dict with a 24-hour TTL avoids re-billing for the same number. `is_cache_valid()` compares the stored timestamp against `CACHE_TTL`, and `from_cache` in the response tells the caller whether the data was fresh.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/lookup` | Look up a number from a JSON body |
| `GET` | `/lookup/<phone_number>` | Look up a number from the URL path |
| `GET` | `/cache/stats` | Inspect the cache for monitoring |

## Step 3: Run It

```bash
python app.py
```

The server starts on `http://localhost:5000`.

## Step 4: Test It

**Look up a number (POST):**

```bash
curl -X POST http://localhost:5000/lookup \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+15551234567"}'
```

**Look up a number (GET):**

```bash
curl http://localhost:5000/lookup/+15551234567
```

Run the same request twice — the second response will include `"from_cache": true`.

**Check the cache:**

```bash
curl http://localhost:5000/cache/stats
```

## Going to Production

This example uses an in-memory cache for simplicity. For production:

- **Shared cache** — replace the in-memory dict with Redis so the cache survives restarts and is shared across instances
- **Authentication** — add API key validation on your endpoints
- **Rate limiting** — protect your endpoints and stay within Telnyx Number Lookup limits
- **Monitoring** — add structured logging and alert on 4xx/5xx rates
- **Persistence** — store lookup history in a database if you need an audit trail

## Resources

- [Source code and reference](./README.md)
- [Endpoint reference](./API.md)
- [Number Lookup Guide](https://developers.telnyx.com/docs/identity/number-lookup)
- [Number Lookup API Reference](https://developers.telnyx.com/api-reference/number-lookup/retrieve-lookup)
- [Telnyx Portal](https://portal.telnyx.com)
