# Text To Speech with Go and Gin

## What Does This Example Do?

Build a production-ready Gin endpoint that plays text-to-speech (TTS) messages during voice calls using the Telnyx Voice API. This tutorial demonstrates the Go SDK client initialization pattern, proper error handling for telecom APIs, secure credential management via environment variables, and the command-event model for call control.

## Who Is This For?

- **Go developers** building voice features with Gin.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Go 1.19 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound calls.
- A Call Control Application ID (connection_id) configured in the Telnyx Portal.
- A publicly accessible webhook URL (ngrok or similar for local development).
- go get (Go package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-to-speech-phone-call-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-to-speech-phone-call-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` and initialize the Telnyx client using the Go SDK pattern. Define helper functions to handle call initiation and TTS playback with proper validation:

```go
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go/v2"
	"github.com/telnyx/telnyx-go/v2/call"
)

// Initialize Telnyx client at package level
var client *telnyx.Client

func init() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}

	// Initialize Telnyx client with API key
	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		log.Fatal("TELNYX_API_KEY environment variable not set")
	}

	client = telnyx.NewClient(telnyx.WithAPIKey(apiKey))
}

// InitiateCallRequest represents the JSON payload for initiating a call
type InitiateCallRequest struct {
	To  string `json:"to" binding:"required"`
	TTS string `json:"tts" binding:"required"`
}

// CallResponse represents the JSON response after initiating a call
type CallResponse struct {
	CallControlID string `json:"call_control_id"`
	From          string `json:"from"`
	To            string `json:"to"`
	Status        string `json:"status"`
}

// initiateCall creates an outbound call and returns the call control ID
func initiateCall(toNumber, ttsMessage string) (*CallResponse, error) {
	fromNumber := os.Getenv("TELNYX_PHONE_NUMBER")
	if fromNumber == "" {
		return nil, fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}

	connectionID := os.Getenv("TELNYX_CONNECTION_ID")
	if connectionID == "" {
		return nil, fmt.Errorf("TELNYX_CONNECTION_ID environment variable not set")
	}

	// Validate E.164 format to prevent API errors
	if toNumber == "" || toNumber[0] != '+' {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Initiate the call using the Telnyx SDK
	// Note: call_control_id is returned in the response, not passed as input
	response, err := client.Calls.Dial(&call.DialRequest{
		From:         fromNumber,
		To:           toNumber,
		ConnectionID: connectionID,
	})

	if err != nil {
		return nil, err
	}

	// Extract serializable data from SDK response
	return &CallResponse{
		CallControlID: response.Data.CallControlID,
		From:          fromNumber,
		To:            toNumber,
		Status:        "initiated",
	}, nil
}

// WebhookPayload represents the structure of incoming webhook events
type WebhookPayload struct {
	Data struct {
		CallControlID string `json:"call_control_id"`
		State         string `json:"state"`
		EventType     string `json:"event_type"`
	} `json:"data"`
}

// handleCallWebhook processes incoming call events and plays TTS when call is answered
func handleCallWebhook(c *gin.Context) {
	var payload WebhookPayload

	if err := c.BindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	callControlID := payload.Data.CallControlID
	eventType := payload.Data.EventType

	log.Printf("Received webhook event: %s for call: %s", eventType, callControlID)

	// When call is answered, play TTS message
	if eventType == "call.answered" {
		// In production, retrieve the TTS message from your database or cache
		// For this example, we use a default message
		ttsMessage := "Hello! This is a text to speech message from Telnyx."

		// Play TTS using the Telnyx SDK
		_, err := client.Calls.Speak(callControlID, &call.SpeakRequest{
			Payload: ttsMessage,
			Voice:   "female",
			Language: "en-US",
		})

		if err != nil {
			log.Printf("Error playing TTS: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to play TTS"})
			return
		}

		log.Printf("TTS playback started for call: %s", callControlID)
	}

	// Acknowledge webhook receipt
	c.JSON(http.StatusOK, gin.H{"status": "received"})
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/text-to-speech-phone-call-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Go server. |
| Invalid Phone Number Format | You receive a 400 error stating "phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Connection ID Not Set | The application returns `{"error": "TELNYX_CONNECTION_ID environment variable not set"}` on the first call attempt. | Confirm your `.env` file exists in the same directory as `main.go` and contains the `TELNYX_CONNECTION_ID` variable. This value is your Call Control Application ID from the Telnyx Portal. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `godotenv.Load()` call must execute before `os.Getenv()` is called—verify this import order in your code. |
| Webhook Events Not Received | TTS playback does not trigger even though the call is initiated successfully. | Ensure your webhook URL is publicly accessible and matches the URL configured in your Call Control Application settings in the Telnyx Portal. Use ngrok to expose your local server: `ngrok http 8080`, then update the webhook URL to `https://your-ngrok-url.ngrok.io/webhooks/call`. Verify that your firewall allows inbound HTTPS traffic on port 8080. |
| TTS Playback Fails | The call connects but no audio is played, and logs show "Error playing TTS". | Verify that the `call.answered` event is being received by checking your server logs. Ensure the TTS message is not empty and the voice parameter is valid (e.g., "male" or "female"). Check that your Telnyx account has TTS enabled and sufficient credits. Review the Telnyx API documentation for supported languages and voice options. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Go version do I need?**

Go 1.22 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Voice API Overview](https://developers.telnyx.com/docs/voice)
- [Voice API Commands](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources)
- [AI Assistant Start](https://developers.telnyx.com/docs/voice/programmable-voice/ai-assistant-start)
- [Call Control API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx Voice API](https://telnyx.com/products/voice-api)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [Handle Inbound Call Webhooks with Go](/tutorials/voice/go/inbound-call-webhook).
- [Record Voice Calls with Go](/tutorials/voice/go/call-recording).
- [Build an IVR Menu with Go](/tutorials/voice/go/ivr-menu).
