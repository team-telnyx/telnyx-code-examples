# Inbound Call Webhook with Go and Gin

## What Does This Example Do?

Build a production-ready Gin endpoint that receives and processes inbound call webhooks from the Telnyx Voice API. This tutorial demonstrates how to handle call lifecycle events (initiated, answered, hangup), validate webhook signatures, and respond with proper HTTP status codes. You'll learn the command-event model that powers Telnyx Call Control and how to integrate it into a real-world Go application.

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
- A Telnyx phone number enabled for inbound calls.
- A publicly accessible URL (ngrok, Cloudflare Tunnel, or deployed server) to receive webhooks.
- Basic familiarity with Go and HTTP servers.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/route-phone-calls-to-ai-agent-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/route-phone-calls-to-ai-agent-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` and set up the Gin server with webhook handling:

```go
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2"
)

// WebhookPayload represents the structure of a Telnyx webhook event.
type WebhookPayload struct {
	Data struct {
		EventType      string `json:"event_type"`
		CallControlID  string `json:"call_control_id"`
		From           string `json:"from"`
		To             string `json:"to"`
		State          string `json:"state"`
		Direction      string `json:"direction"`
		StartTime      string `json:"start_time"`
		AnswerTime     string `json:"answer_time"`
		EndTime        string `json:"end_time"`
		DisconnectCode string `json:"disconnect_code"`
	} `json:"data"`
}

func init() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}
}

func main() {
	// Initialize Telnyx client with API key from environment
	client := telnyx.NewClient(option.WithAPIKey(os.Getenv("TELNYX_API_KEY")))

	// Create Gin router
	router := gin.Default()

	// Middleware to log incoming requests
	router.Use(gin.Logger())

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Webhook endpoint for inbound call events
	router.POST("/webhooks/call", func(c *gin.Context) {
		handleCallWebhook(c, client)
	})

	// Start server on configured port
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting Gin server on port %s\n", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// handleCallWebhook processes inbound call events from Telnyx.
func handleCallWebhook(c *gin.Context, client *telnyx.Client) {
	var payload WebhookPayload

	// Parse JSON payload from webhook
	if err := c.ShouldBindJSON(&payload); err != nil {
		log.Printf("Invalid webhook payload: %v\n", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	eventType := payload.Data.EventType
	callControlID := payload.Data.CallControlID
	from := payload.Data.From
	to := payload.Data.To

	log.Printf("Received webhook: event_type=%s, call_control_id=%s, from=%s, to=%s\n",
		eventType, callControlID, from, to)

	// Handle different call lifecycle events
	switch eventType {
	case "call.initiated":
		handleCallInitiated(c, callControlID, from, to, client)

	case "call.answered":
		handleCallAnswered(c, callControlID, from, to)

	case "call.hangup":
		handleCallHangup(c, callControlID, payload.Data.DisconnectCode)

	case "call.dtmf.received":
		handleDTMFReceived(c, callControlID)

	default:
		log.Printf("Unhandled event type: %s\n", eventType)
		c.JSON(http.StatusOK, gin.H{"message": "Event received"})
	}
}

// handleCallInitiated processes the call.initiated event.
// This fires when an inbound call arrives at your Telnyx number.
func handleCallInitiated(c *gin.Context, callControlID, from, to string, client *telnyx.Client) {
	log.Printf("Call initiated from %s to %s\n", from, to)

	// Automatically answer the call
	// In production, you might add logic to screen calls, route to agents, etc.
	answerParams := &telnyx.CallAnswerParams{
		CallControlID: callControlID,
	}

	response, err := client.Calls.Answer(answerParams)
	if err != nil {
		log.Printf("Failed to answer call: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to answer call"})
		return
	}

	log.Printf("Call answered successfully: %+v\n", response)

	// Return 200 OK to acknowledge webhook receipt
	c.JSON(http.StatusOK, gin.H{
		"message":         "Call answered",
		"call_control_id": callControlID,
	})
}

// handleCallAnswered processes the call.answered event.
// This fires when the call is successfully connected.
func handleCallAnswered(c *gin.Context, callControlID, from, to string) {
	log.Printf("Call answered: from=%s, to=%s\n", from, to)

	// In production, you might:
	// - Start recording the call
	// - Play a greeting message
	// - Route to an IVR menu
	// - Log call metadata to a database

	c.JSON(http.StatusOK, gin.H{
		"message":         "Call answered event processed",
		"call_control_id": callControlID,
	})
}

// handleCallHangup processes the call.hangup event.
// This fires when either party disconnects.
func handleCallHangup(c *gin.Context, callControlID, disconnectCode string) {
	log.Printf("Call ended: call_control_id=%s, disconnect_code=%s\n", callControlID, disconnectCode)

	// In production, you might:
	// - Stop recording and save the file
	// - Update call duration in database
	// - Trigger post-call workflows (transcription, analysis, etc.)

	c.JSON(http.StatusOK, gin.H{
		"message":         "Call hangup event processed",
		"call_control_id": callControlID,
	})
}

// handleDTMFReceived processes DTMF (dial tone) events.
// This fires when the caller presses a digit during the call.
func handleDTMFReceived(c *gin.Context, callControlID string) {
	log.Printf("DTMF received on call: %s\n", callControlID)

	// In production, you might:
	// - Route based on digit pressed (IVR menu)
	// - Validate PIN entry
	// - Trigger actions based on user input

	c.JSON(http.StatusOK, gin.H{
		"message":         "DTMF event processed",
		"call_control_id": callControlID,
	})
}
```

## Complete Code

See [`main.go`](./main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not triggering | You call your Telnyx number but the webhook endpoint is never hit. | Verify the webhook URL in the Telnyx Portal matches your public ngrok URL exactly (including `https://` and the `/webhooks/call` path). Ensure your local server is running (`go run main.go`). Check ngrok logs to confirm the request is being forwarded. If using a firewall, ensure port 8080 is not blocked. |
| Authentication Error (401) | The Telnyx client initialization fails with "Invalid API key" or similar error. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated, update your `.env` file and restart the server. |
| Call not answering automatically | Inbound calls arrive but are not automatically answered by your webhook handler. | Confirm the `call.initiated` event handler is being triggered (check server logs). Verify the `TELNYX_CONNECTION_ID` is correctly set in your `.env` file and matches your Call Control Application ID in the Portal. Ensure your Telnyx phone number is linked to the correct Call Control Application. |
| JSON parsing error | The server logs "Invalid webhook payload" when a call arrives. | Verify the webhook payload structure matches the `WebhookPayload` struct in your code. Check that Telnyx is sending the correct JSON format. Use `curl` to manually test the endpoint with a sample payload to isolate the issue. |

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

- [Make an Outbound Call with Go](/tutorials/voice/go/outbound-call).
- [Record Inbound Calls with Go](/tutorials/voice/go/call-recording).
- [Build an IVR Menu with Go](/tutorials/voice/go/ivr-menu).
