# Clone AI Assistant with Node.js and Express

Build a production-ready Express endpoint that clones an existing AI Assistant using the Telnyx Node.js SDK.

## How It Works

```
  Client request
        │
        ▼
  ┌────────────────────┐
  │  Node.js Server     │  receives request
  └─────────┬──────────┘
        │  Telnyx API call
        ▼
  ┌────────────────────┐
  │  Telnyx AI Assistants│  processes and responds
  └────────────────────┘
```

## Telnyx Products Used

- **AI Assistants** — [Documentation](https://developers.telnyx.com/docs/ai)

## Prerequisites

- Node.js 16 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- An existing AI Assistant to clone (create one first using the [Create AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/nodejs/create-ai-assistant) tutorial if needed).
- npm (Node.js package manager).

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/clone-ai-assistant-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your Telnyx credentials:

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | KEY_your_telnyx_api_key_here |
| `PORT` | 5000 |

## Step 2: Understand the Code

The main application logic lives in `server.js`.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/assistants/clone` | API endpoint |
| `GET` | `/assistants/:id` | API endpoint |

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:5000`.

For webhook-based features, expose your local server:

```bash
ngrok http 5000
```

## Step 4: Test It

```bash
curl http://localhost:5000/assistants/:id
```

## Going to Production

- **Environment variables** — never commit API keys; use a secrets manager.
- **Authentication** — protect your endpoints with API key validation.
- **Monitoring** — add structured logging and alerting.
- **Rate limiting** — protect endpoints from abuse.
- **Database** — replace any in-memory storage with a persistent store.

## Resources

- [Source code](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/clone-ai-assistant-nodejs/README.md)
- [API reference](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/clone-ai-assistant-nodejs/API.md)
- [AI Assistants Documentation](https://developers.telnyx.com/docs/ai)
- [Telnyx Portal](https://portal.telnyx.com)
