# After Hours Nurse Triage

AI-powered after-hours medical triage that screens symptoms, routes urgent cases to on-call via PagerDuty, and queues non-urgent for morning callback

## Quick Start

```bash
cp .env.example .env
# Edit .env with your credentials
pip install -r requirements.txt
python app.py
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | Telnyx Api Key |
| `MAIN_NUMBER` | Main Number |
| `CONNECTION_ID` | Connection Id |
| `AI_MODEL` | Ai Model |
| `PAGERDUTY_ROUTING_KEY` | Pagerduty Routing Key |
| `NURSE_SLACK_WEBHOOK` | Nurse Slack Webhook |
| `PORT` | Port |

## API Endpoints

Start the server and visit `http://localhost:5000/health` for status.
