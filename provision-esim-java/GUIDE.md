# eSIM Provisioning with Java and Spring

Build a production-ready Spring Boot application that provisions eSIM profiles over-the-air using the Telnyx IoT SIM Management API.

## How It Works

```
  Client request
        │
        ▼
  ┌────────────────────┐
  │  Java Server        │  receives request
  └─────────┬──────────┘
        │  Telnyx API call
        ▼
  ┌────────────────────┐
  │  Telnyx IoT SIM Management│  processes and responds
  └────────────────────┘
```

## Telnyx Products Used

- **IoT SIM Management** — [Documentation](https://developers.telnyx.com/docs/iot)

## Prerequisites

- Java 11 or higher.
- Maven 3.6+ or Gradle 7.0+.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- Access to the Telnyx IoT SIM Management API.
- A publicly accessible URL for webhook callbacks (ngrok or similar for local testing).
- Postman or curl for testing endpoints.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/provision-esim-java
cp .env.example .env
mvn clean install
```

Edit `.env` with your Telnyx credentials:

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | KEY_your_telnyx_api_key_here |

## Step 2: Understand the Code

The main application logic lives in `*.java`.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/esim` | API endpoint |
| `POST` | `/provision` | API endpoint |
| `GET` | `/{simCardId}/status` | API endpoint |
| `GET` | `/group/{simCardGroupId}/list` | API endpoint |
| `GET` | `/webhooks` | Webhook handler |
| `POST` | `/sim-events` | API endpoint |

## Step 3: Run It

```bash
mvn spring-boot:run
```

The server starts on `http://localhost:5000`.

For webhook-based features, expose your local server:

```bash
ngrok http 5000
```

## Step 4: Test It

```bash
curl http://localhost:5000/esim
```

## Going to Production

- **Environment variables** — never commit API keys; use a secrets manager.
- **Authentication** — protect your endpoints with API key validation.
- **Monitoring** — add structured logging and alerting.
- **Rate limiting** — protect endpoints from abuse.
- **Database** — replace any in-memory storage with a persistent store.

## Resources

- [Source code](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-java/README.md)
- [API reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-java/API.md)
- [IoT SIM Management Documentation](https://developers.telnyx.com/docs/iot)
- [Telnyx Portal](https://portal.telnyx.com)
