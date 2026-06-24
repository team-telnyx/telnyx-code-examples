# Call Transfer with Go and Gin

## What Does This Example Do?

Build a production-ready Gin web service that initiates outbound calls and transfers them to another number using the Telnyx Voice API. This tutorial demonstrates the Go SDK client initialization pattern, webhook event handling for call state changes, proper error handling for telecom APIs, and secure credential management via environment variables.

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

- Go 1.18 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound calls.
- A Call Control Application configured in the Telnyx Portal with a connection ID.
- A publicly accessible webhook URL (use ngrok for local development).
- go get (Go package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/transfer-live-phone-calls-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/transfer-live-phone-calls-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` and initialize the Telnyx client using the Go SDK pattern. Define helper functions to handle call initiation and transfer with proper validation:

```go
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2"
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

// CallInitiateRequest represents the JSON payload for initiating a call
type CallInitiateRequest struct {
	To string `json:"to" binding:"required"`
}

// CallTransferRequest represents the JSON payload for transferring a call
type CallTransferRequest struct {
	CallControlID string `json:"call_control_id" binding:"required"`
	TransferTo    string `json:"transfer_to" binding:"required"`
}

// initiateCall creates an outbound call and returns the call control ID
func initiateCall(toNumber string) (map[string]interface{}, error) {
	fromNumber := os.Getenv("TELNYX_PHONE_NUMBER")
	if fromNumber == "" {
		return nil, fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}

	connectionID := os.Getenv("TELNYX_CONNECTION_ID")
	if connectionID == "" {
		return nil, fmt.Errorf("TELNYX_CONNECTION_ID environment variable not set")
	}

	// Validate E.164 format to prevent API errors
	if len(toNumber) == 0 || toNumber[0] != '+' {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Call the Telnyx API to initiate the call
	response, err := client.Calls.Dial(
		&telnyx.CallDialRequest{
			From:         fromNumber,
			To:           toNumber,
			ConnectionID: connectionID,
		},
	)
	if err != nil {
		return nil, err
	}

	// Extract serializable data — SDK objects are NOT JSON-serializable
	return map[string]interface{}{
		"call_control_id": response.Data.CallControlID,
		"from":            fromNumber,
		"to":              toNumber,
		"state":           response.Data.State,
	}, nil
}

// transferCall transfers an active call to another number
func transferCall(callControlID, transferTo string) (map[string]interface{}, error) {
	// Validate E.164 format
	if len(transferTo) == 0 || transferTo[0] != '+' {
		return nil, fmt.Errorf("transfer number must be in E.164 format (e.g., +15551234567)")
	}

	// Call the Telnyx API to transfer the call
	response, err := client.Calls.Actions.Transfer(
		callControlID,
		&telnyx.CallTransferRequest{
			To: transferTo,
		},
	)
	if err != nil {
		return nil, err
	}

	// Extract serializable data
	return map[string]interface{}{
		"call_control_id": response.Data.CallControlID,
		"transfer_to":     transferTo,
		"state":           response.Data.State,
	}, nil
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Go server. |
| Invalid Phone Number Format | You receive a 400 error stating "phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl requests to use properly formatted numbers. |
| Connection ID Not Set | The application raises an error "TELNYX_CONNECTION_ID environment variable not set" on the first call initiation. | Confirm your `.env` file exists in the same directory as `main.go` and contains the `TELNYX_CONNECTION_ID` variable. The value should be your Call Control Application ID from the Telnyx Portal. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). Restart the server after updating the file. |
| Call Transfer Fails with "Call Not Found" | The transfer endpoint returns a 404 or error indicating the call control ID is invalid or the call has already ended. | Verify the `call_control_id` from the initiate call response is correct and the call is still active. Call state transitions quickly—ensure the transfer request is sent while the call is in an active state (not "completed" or "hangup"). Check webhook events to monitor call state changes. |
| Webhook Events Not Received | The `/webhooks/call-events` endpoint is not receiving POST requests from Telnyx. | Ensure your webhook URL is publicly accessible and configured in the Telnyx Portal under your Call Control Application settings. For local development, use ngrok to expose your server: `ngrok http 8080`, then update the webhook URL in the Portal to your ngrok URL (e.g., `https://your-ngrok-url.ngrok.io/webhooks/call-events`). Verify the server is running and listening on port 8080. |

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

- [Receive Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/inbound-call-webhook).
- [Record Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/call-recording).
- [Build an IVR Menu](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/ivr-menu).
