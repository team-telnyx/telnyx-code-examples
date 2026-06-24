# Number Lookup with Ruby and Sinatra

Build a production-ready Sinatra endpoint that performs number lookups using the Telnyx SMS API.

## How It Works

```
  Client request
        │
        ▼
  ┌────────────────────┐
  │  Ruby Server        │  receives request
  └─────────┬──────────┘
        │  Telnyx API call
        ▼
  ┌────────────────────┐
  │  Telnyx Phone Numbers│  processes and responds
  └────────────────────┘
```

## Telnyx Products Used

- **Phone Numbers** — [Documentation](https://developers.telnyx.com/docs/numbers)

## Prerequisites

- Ruby 2.7 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- Bundler (Ruby dependency manager).
- curl or Postman for testing HTTP endpoints.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/phone-number-lookup-ruby
cp .env.example .env
bundle install
```

Edit `.env` with your Telnyx credentials:

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | KEY_your_telnyx_api_key_here |

## Step 2: Understand the Code

The main application logic lives in `app.rb`.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | API endpoint |
| `POST` | `/lookup` | API endpoint |

## Step 3: Run It

```bash
ruby app.rb
```

The server starts on `http://localhost:5000`.

For webhook-based features, expose your local server:

```bash
ngrok http 5000
```

## Step 4: Test It

```bash
curl http://localhost:5000/
```

## Going to Production

- **Environment variables** — never commit API keys; use a secrets manager.
- **Authentication** — protect your endpoints with API key validation.
- **Monitoring** — add structured logging and alerting.
- **Rate limiting** — protect endpoints from abuse.
- **Database** — replace any in-memory storage with a persistent store.

## Resources

- [Source code](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-ruby/README.md)
- [API reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-ruby/API.md)
- [Phone Numbers Documentation](https://developers.telnyx.com/docs/numbers)
- [Telnyx Portal](https://portal.telnyx.com)
