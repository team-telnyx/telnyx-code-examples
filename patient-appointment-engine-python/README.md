# Patient Appointment Engine

AI-powered patient appointment booking with calendar integration, copay collection, and staff review dashboard

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
| `STRIPE_API_KEY` | Stripe Api Key |
| `GOOGLE_CALENDAR_WEBHOOK` | Google Calendar Webhook |
| `STAFF_SLACK_WEBHOOK` | Staff Slack Webhook |
| `PORT` | Port |

## API Endpoints

Start the server and visit `http://localhost:5000/health` for status.
