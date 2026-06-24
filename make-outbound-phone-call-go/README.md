# Outbound Call with Go and Gin

## What Does This Example Do?

Build a production-ready Gin endpoint that initiates outbound calls using the Telnyx Go SDK. This tutorial demonstrates the client-based initialization pattern, proper error handling for telecom APIs, secure credential management via environment variables, and the command-event model that powers Telnyx Call Control.

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
- A Call Control Application ID (connection_id) configured in the Telnyx Portal.
- go get (Go package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/make-outbound-phone-call-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/make-outbound-phone-call-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` and initialize the Telnyx client using the Go SDK pattern. Define a helper function to handle call initiation with proper validation:

```go
package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2"
)

// InitiateCallRequest represents the JSON payload for initiating a call.
type InitiateCallRequest struct {
	To string `json:"to" binding:"required"`
}

// CallResponse represents the JSON response after initiating a call.
type CallResponse struct {
	CallControlID string `json:"call_control_id"`
	From          string `json:"from"`
	To            string `json:"to"`
	Status        string `json:"status"`
}

// initiateCall handles the business logic for starting an outbound call.
// It validates the destination number and uses the Telnyx API to dial.
func initiateCall(toNumber string) (*CallResponse, error) {
	fromNumber := os.Getenv("TELNYX_PHONE_NUMBER")
	if fromNumber == "" {
		return nil, fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}

	connectionID := os.Getenv("TELNYX_CONNECTION_ID")
	if connectionID == "" {
		return nil, fmt.Errorf("TELNYX_CONNECTION_ID environment variable not set")
	}

	// Validate E.164 format to prevent API errors.
	if !strings.HasPrefix(toNumber, "+") {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Initialize the Telnyx client with API key from environment.
	client := telnyx.NewClient(option.WithAPIKey(os.Getenv("TELNYX_API_KEY")))

	// Dial the call using the Call Control API.
	// connection_id is the Call Control Application ID (static config).
	// call_control_id is returned in the response and used for subsequent actions.
	response, err := client.Calls.Dial(
		&v2.CallDialRequest{
			From:         fromNumber,
			To:           toNumber,
			ConnectionID: connectionID,
		},
	)
	if err != nil {
		return nil, err
	}

	// Extract serializable data from the SDK response.
	return &CallResponse{
		CallControlID: response.Data.CallControlID,
		From:          fromNumber,
		To:            toNumber,
		Status:        "initiated",
	}, nil
}

func main() {
	// Load environment variables from .env file.
	godotenv.Load()

	// Create a new Gin router.
	router := gin.Default()

	// POST /calls/dial — initiate an outbound call.
	router.POST("/calls/dial", func(c *gin.Context) {
		var req InitiateCallRequest

		// Bind and validate JSON request body.
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Missing required field: 'to'",
			})
			return
		}

		// Call the helper function to initiate the call.
		result, err := initiateCall(req.To)

		// Handle Telnyx SDK errors with appropriate HTTP status codes.
		if err != nil {
			// Check for specific Telnyx error types.
			if _, ok := err.(*telnyx.AuthenticationError); ok {
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Invalid API key",
				})
				return
			}
			if _, ok := err.(*telnyx.RateLimitError); ok {
				c.JSON(http.StatusTooManyRequests, gin.H{
					"error": "Rate limit exceeded. Please slow down.",
				})
				return
			}
			if apiErr, ok := err.(*telnyx.APIStatusError); ok {
				c.JSON(apiErr.StatusCode, gin.H{
					"error":       apiErr.Error(),
					"status_code": apiErr.StatusCode,
				})
				return
			}
			if _, ok := err.(*telnyx.APIConnectionError); ok {
				c.JSON(http.StatusServiceUnavailable, gin.H{
					"error": "Network error connecting to Telnyx",
				})
				return
			}

			// Handle validation errors (E.164 format, missing env vars).
			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
			})
			return
		}

		// Return the call control ID and metadata on success.
		c.JSON(http.StatusOK, result)
	})

	// Start the Gin server on port 8080.
	router.Run(":8080")
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Go server. |
| Invalid Phone Number Format | You receive a 400 error stating "phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Connection ID Not Set | The application returns `{"error": "TELNYX_CONNECTION_ID environment variable not set"}` on the first request. | Confirm your `.env` file exists in the same directory as `main.go` and contains the `TELNYX_CONNECTION_ID` variable. The `godotenv.Load()` call must execute before `os.Getenv()` is called. Verify the connection ID matches your Call Control Application ID from the Telnyx Portal. |

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

- [Receive Inbound Call Webhooks with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/inbound-call-webhook).
- [Record Calls with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/call-recording).
- [Transfer Calls with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/call-transfer).
