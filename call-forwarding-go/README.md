# Call Forwarding with Go and Gin

## What Does This Example Do?

Build a production-ready call forwarding system using Go, Gin, and the Telnyx Voice API. This tutorial demonstrates how to intercept inbound calls, forward them to a designated number, and handle call control events via webhooks. You'll learn the command-event model that powers Telnyx Call Control, manage call state across webhook events, and implement proper error handling for telecom workflows.

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
- A Call Control Application configured in the Telnyx Portal (note the Connection ID).
- A publicly accessible URL for webhook delivery (ngrok, Cloudflare Tunnel, or similar for local testing).
- Basic familiarity with Go, REST APIs, and webhook patterns.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-forwarding-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-forwarding-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` and implement the call forwarding logic. The application will:

1. Listen for incoming call webhooks.
2. Answer the inbound call.
3. Transfer the call to the forwarding destination.
4. Handle call state transitions and cleanup.

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

// CallEvent represents the webhook payload from Telnyx.
type CallEvent struct {
	Data struct {
		EventType      string `json:"event_type"`
		CallControlID  string `json:"call_control_id"`
		ConnectionID   string `json:"connection_id"`
		From           string `json:"from"`
		To             string `json:"to"`
		State          string `json:"state"`
		CallSessionID  string `json:"call_session_id"`
	} `json:"data"`
}

// CallState tracks active calls for forwarding.
var callState = make(map[string]bool)

func init() {
	// Load environment variables from .env file.
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}
}

// answerCall answers an inbound call.
func answerCall(callControlID string) error {
	client := telnyx.NewClient(telnyx.WithAPIKey(os.Getenv("TELNYX_API_KEY")))
	
	params := &call.AnswerParams{}
	_, err := client.Calls.Answer(callControlID, params)
	if err != nil {
		return fmt.Errorf("failed to answer call: %w", err)
	}
	return nil
}

// transferCall transfers an active call to the forwarding destination.
func transferCall(callControlID, toNumber string) error {
	client := telnyx.NewClient(telnyx.WithAPIKey(os.Getenv("TELNYX_API_KEY")))
	
	params := &call.TransferParams{
		To: toNumber,
	}
	_, err := client.Calls.Transfer(callControlID, params)
	if err != nil {
		return fmt.Errorf("failed to transfer call: %w", err)
	}
	return nil
}

// hangupCall terminates a call.
func hangupCall(callControlID string) error {
	client := telnyx.NewClient(telnyx.WithAPIKey(os.Getenv("TELNYX_API_KEY")))
	
	params := &call.HangupParams{}
	_, err := client.Calls.Hangup(callControlID, params)
	if err != nil {
		return fmt.Errorf("failed to hangup call: %w", err)
	}
	return nil
}

// handleCallInitiated processes the call.initiated webhook event.
func handleCallInitiated(c *gin.Context, event *CallEvent) {
	callControlID := event.Data.CallControlID
	
	// Track this call as active.
	callState[callControlID] = true
	
	log.Printf("Inbound call initiated: %s from %s to %s", callControlID, event.Data.From, event.Data.To)
	
	// Answer the call.
	if err := answerCall(callControlID); err != nil {
		log.Printf("Error answering call %s: %v", callControlID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to answer call"})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{"status": "call answered"})
}

// handleCallAnswered processes the call.answered webhook event.
func handleCallAnswered(c *gin.Context, event *CallEvent) {
	callControlID := event.Data.CallControlID
	forwardTo := os.Getenv("FORWARD_TO_NUMBER")
	
	if forwardTo == "" {
		log.Printf("FORWARD_TO_NUMBER not configured")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Forwarding destination not configured"})
		return
	}
	
	log.Printf("Call answered: %s, transferring to %s", callControlID, forwardTo)
	
	// Transfer the call to the forwarding destination.
	if err := transferCall(callControlID, forwardTo); err != nil {
		log.Printf("Error transferring call %s: %v", callControlID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to transfer call"})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{"status": "call transferred"})
}

// handleCallHangup processes the call.hangup webhook event.
func handleCallHangup(c *gin.Context, event *CallEvent) {
	callControlID := event.Data.CallControlID
	
	// Clean up call state.
	delete(callState, callControlID)
	
	log.Printf("Call ended: %s (state: %s)", callControlID, event.Data.State)
	
	c.JSON(http.StatusOK, gin.H{"status": "call hangup processed"})
}

// webhookHandler processes incoming Telnyx webhook events.
func webhookHandler(c *gin.Context) {
	var event CallEvent
	
	// Parse the JSON payload.
	if err := c.BindJSON(&event); err != nil {
		log.Printf("Invalid webhook payload: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid payload"})
		return
	}
	
	eventType := event.Data.EventType
	log.Printf("Received webhook event: %s", eventType)
	
	// Route to appropriate handler based on event type.
	switch eventType {
	case "call.initiated":
		handleCallInitiated(c, &event)
	case "call.answered":
		handleCallAnswered(c, &event)
	case "call.hangup":
		handleCallHangup(c, &event)
	default:
		log.Printf("Unhandled event type: %s", eventType)
		c.JSON(http.StatusOK, gin.H{"status": "event received"})
	}
}

// healthCheck provides a simple health endpoint.
func healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "healthy"})
}

// getCallStatus returns the status of active calls.
func getCallStatus(c *gin.Context) {
	activeCount := len(callState)
	c.JSON(http.StatusOK, gin.H{
		"active_calls": activeCount,
		"forwarding_to": os.Getenv("FORWARD_TO_NUMBER"),
	})
}

func main() {
	// Initialize Gin router.
	router := gin.Default()
	
	// Register routes.
	router.GET("/health", healthCheck)
	router.POST("/webhooks/call", webhookHandler)
	router.GET("/status", getCallStatus)
	
	// Global error handler for Telnyx SDK exceptions.
	router.Use(func(c *gin.Context) {
		c.Next()
		
		// Check for errors set during request processing.
		if len(c.Errors) > 0 {
			err := c.Errors.Last()
			
			// Map Telnyx exceptions to HTTP status codes.
			switch err.Type {
			case gin.ErrorTypeBind:
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
			}
		}
	})
	
	// Start the server on port 8080.
	port := ":8080"
	log.Printf("Starting call forwarding server on %s", port)
	if err := router.Run(port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-forwarding-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhooks not received | The server is running but Telnyx is not sending webhook events. | Verify the webhook URL in the Telnyx Portal matches your public URL exactly (including protocol and path). Ensure your firewall and ngrok tunnel are active. Check server logs for incoming requests. Test with `curl -X POST http://localhost:8080/webhooks/call -H "Content-Type: application/json" -d '{"data":{"event_type":"call.initiated","call_control_id":"test123"}}'` to verify the endpoint is reachable. |
| Call transfer fails with API error | The transfer command returns an error like "Invalid destination" or "Call not in transferable state." | Ensure the `FORWARD_TO_NUMBER` is in E.164 format (e.g., `+15551234567`). Verify the call is in the `answered` state before attempting transfer—only transfer after receiving the `call.answered` webhook. Check that your Telnyx account has outbound calling permissions. |
| Authentication error (401) | The SDK returns an authentication error when calling Telnyx APIs. | Verify your `TELNYX_API_KEY` in the `.env` file is correct and matches the key in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or special characters. Restart the server after updating the `.env` file. |
| Call state not tracked | Active calls are not appearing in the `/status` endpoint response. | Verify that the `call.initiated` webhook is being received and logged. Check that `callState` is being populated in the `handleCallInitiated` function. Ensure the `call_control_id` from the webhook matches what you're querying. |
| ngrok tunnel disconnects | The public URL becomes invalid after ngrok restarts. | Upgrade to ngrok's paid plan for a static URL, or reconfigure the webhook URL in the Telnyx Portal each time ngrok restarts. For production, use a permanent domain with a reverse proxy or cloud hosting. |

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

- [Initiate an Outbound Call](/tutorials/voice/go/outbound-call).
- [Handle Inbound Call Webhooks](/tutorials/voice/go/inbound-call-webhook).
- [Record and Retrieve Call Recordings](/tutorials/voice/go/call-recording).
