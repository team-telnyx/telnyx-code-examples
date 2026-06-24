# SIP Registration with Java and Spring

Build a production-ready Spring Boot application that manages SIP connection registration with the Telnyx SIP Trunking API.

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
  │  Telnyx SIP Trunking│  processes and responds
  └────────────────────┘
```

## Telnyx Products Used

- **SIP Trunking** — [Documentation](https://developers.telnyx.com/docs/sip-trunking)

## Prerequisites

- Java 11 or higher.
- Maven 3.6+ or Gradle 7.0+.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A SIP endpoint (PBX, SBC, or softphone) ready to register.
- Basic familiarity with Spring Boot and REST APIs.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-registration-java
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
| `GET` | `/api/sip` | API endpoint |
| `POST` | `/register` | API endpoint |
| `GET` | `/connections/{connectionId}` | API endpoint |

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
curl http://localhost:5000/api/sip
```

## Going to Production

- **Environment variables** — never commit API keys; use a secrets manager.
- **Authentication** — protect your endpoints with API key validation.
- **Monitoring** — add structured logging and alerting.
- **Rate limiting** — protect endpoints from abuse.
- **Database** — replace any in-memory storage with a persistent store.

## Resources

- [Source code](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-java/README.md)
- [API reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-java/API.md)
- [SIP Trunking Documentation](https://developers.telnyx.com/docs/sip-trunking)
- [Telnyx Portal](https://portal.telnyx.com)
