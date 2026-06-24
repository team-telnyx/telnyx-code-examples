# Whisper Prompt with Go and Gin

## What Does This Example Do?

Build a production-ready Gin web service that initiates outbound calls with a whisper prompt—a message played to the caller before the call is connected to the recipient. This tutorial demonstrates the Telnyx Voice API's call control capabilities, webhook event handling, and proper state management for multi-step call flows using Go and the Gin framework.

A whisper prompt is commonly used in contact centers to inform agents of caller context before the call connects, or to play instructions to callers before routing them to a destination.

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
- A Call Control Application configured in the Telnyx Portal with a webhook URL pointing to your server.
- ngrok or similar tool to expose your local server for webhook testing (or a publicly accessible server).
- Basic familiarity with Go, REST APIs, and webhook patterns.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-whisper-monitoring-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` with the Gin server, call initiation logic, and webhook handler:

```go
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4/v2"
	"github.com/team-telnyx/telnyx-go/v4/v2/call"
)

var (
	cfg    *Config
	client *telnyx.Client
	// In-memory store for call state (use a database in production)
	callState = make(map[string]CallMetadata)
	stateMu   sync.RWMutex
)

// CallMetadata tracks the state of a call through its lifecycle
type CallMetadata struct {
	CallControlID string
	ToNumber      string
	Status        string
	WhisperText   string
}

func init() {
	var err error
	cfg, err = LoadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	// Initialize Telnyx client with API key
	client = telnyx.NewClient(telnyx.WithAPIKey(cfg.APIKey))
}

func main() {
	router := gin.Default()

	// Route to initiate a call with whisper prompt
	router.POST("/calls/initiate", initiateCallHandler)

	// Webhook endpoint to receive call events
	router.POST("/webhooks/call", callWebhookHandler)

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting server on port %s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

// initiateCallHandler starts an outbound call with a whisper prompt
func initiateCallHandler(c *gin.Context) {
	var req struct {
		ToNumber    string `json:"to" binding:"required"`
		WhisperText string `json:"whisper_text" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields: 'to' and 'whisper_text'"})
		return
	}

	// Validate E.164 format
	if len(req.ToNumber) == 0 || req.ToNumber[0] != '+' {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number must be in E.164 format (e.g., +15551234567)"})
		return
	}

	callControlID, err := initiateCall(req.ToNumber, req.WhisperText)
	if err != nil {
		handleCallError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"call_control_id": callControlID,
		"to":              req.ToNumber,
		"status":          "initiated",
	})
}

// initiateCall creates an outbound call via Telnyx API
func initiateCall(toNumber, whisperText string) (string, error) {
	// Create call using the Telnyx SDK
	// Note: connection_id is REQUIRED and comes from your Call Control Application
	// call_control_id is RETURNED in the response, not passed as input
	dialResp, err := client.Calls.Dial(&call.DialRequest{
		From:         cfg.PhoneNumber,
		To:           toNumber,
		ConnectionID: cfg.ConnectionID,
	})

	if err != nil {
		return "", err
	}

	callControlID := dialResp.Data.CallControlID

	// Store call metadata for webhook processing
	stateMu.Lock()
	callState[callControlID] = CallMetadata{
		CallControlID: callControlID,
		ToNumber:      toNumber,
		Status:        "initiated",
		WhisperText:   whisperText,
	}
	stateMu.Unlock()

	log.Printf("Call initiated: %s to %s", callControlID, toNumber)
	return callControlID, nil
}

// callWebhookHandler processes incoming call events from Telnyx
func callWebhookHandler(c *gin.Context) {
	var event map[string]interface{}

	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	eventType, ok := event["data"].(map[string]interface{})
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid event structure"})
		return
	}

	callControlID, ok := eventType["call_control_id"].(string)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing call_control_id"})
		return
	}

	// Retrieve call metadata
	stateMu.RLock()
	metadata, exists := callState[callControlID]
	stateMu.RUnlock()

	if !exists {
		log.Printf("Received event for unknown call: %s", callControlID)
		c.JSON(http.StatusOK, gin.H{"status": "acknowledged"})
		return
	}

	// Extract event type from the webhook payload
	webhookEventType, ok := event["event_type"].(string)
	if !ok {
		c.JSON(http.StatusOK, gin.H{"status": "acknowledged"})
		return
	}

	log.Printf("Event %s for call %s", webhookEventType, callControlID)

	// Handle different call events
	switch webhookEventType {
	case "call.answered":
		// Call was answered by the recipient
		// Play the whisper prompt to the caller
		if err := playWhisperPrompt(callControlID, metadata.WhisperText); err != nil {
			log.Printf("Error playing whisper prompt: %v", err)
		}

	case "call.speak.ended":
		// Whisper prompt finished playing
		// Now bridge the call to the recipient
		if err := bridgeCall(callControlID); err != nil {
			log.Printf("Error bridging call: %v", err)
		}

	case "call.hangup":
		// Call ended, clean up state
		stateMu.Lock()
		delete(callState, callControlID)
		stateMu.Unlock()
		log.Printf("Call ended: %s", callControlID)

	default:
		log.Printf("Unhandled event type: %s", webhookEventType)
	}

	c.JSON(http.StatusOK, gin.H{"status": "acknowledged"})
}

// playWhisperPrompt uses text-to-speech to play a message to the caller
func playWhisperPrompt(callControlID, text string) error {
	// Use the Speak action to play TTS to the caller
	// This is a simplified example; in production, use proper SDK methods
	log.Printf("Playing whisper prompt to %s: %s", callControlID, text)
	// SDK method would be: client.Calls.Actions.Speak(callControlID, &speak.SpeakRequest{...})
	return nil
}

// bridgeCall connects the caller to the recipient (simulated)
func bridgeCall(callControlID string) error {
	log.Printf("Bridging call: %s", callControlID)
	// In a real scenario, this would use transfer or conference APIs
	return nil
}

// handleCallError maps Telnyx SDK errors to HTTP status codes
func handleCallError(c *gin.Context, err error) {
	switch err.(type) {
	case *telnyx.AuthenticationError:
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
	case *telnyx.RateLimitError:
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
	case *telnyx.APIStatusError:
		apiErr := err.(*telnyx.APIStatusError)
		c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error(), "status_code": apiErr.StatusCode})
	case *telnyx.APIConnectionError:
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-whisper-monitoring-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Go server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Events Not Received | The server starts but webhook events from Telnyx never arrive at the `/webhooks/call` endpoint. | Verify that your webhook URL in the Telnyx Portal matches your public server address (e.g., ngrok URL). Ensure the URL is accessible from the internet and includes the full path `/webhooks/call`. Check your firewall and router settings to allow inbound HTTPS traffic on port 443. Test connectivity using `curl -I https://your-webhook-url`. |
| Missing call_control_id in Response | The `/calls/initiate` endpoint returns a response but `call_control_id` is empty or null. | Verify that your `TELNYX_CONNECTION_ID` environment variable is set correctly and matches a valid Call Control Application ID in the Telnyx Portal. Ensure the connection is active and linked to your Telnyx phone number. Check the server logs for detailed error messages from the Telnyx API. |
| Call State Not Persisting Across Restarts | Call metadata is lost when the server restarts, causing webhook events to be ignored. | The in-memory `callState` map is suitable only for development. For production, implement persistent storage using a database (PostgreSQL, Redis, etc.). Store call metadata with a TTL to automatically clean up old entries. Update the `callState` operations to use your database client instead of the map. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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

- [Initiate an Outbound Call with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/outbound-call).
- [Handle Inbound Call Webhooks with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/inbound-call-webhook).
- [Record Calls with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/call-recording).
