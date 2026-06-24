# Warm Transfer with Go and Gin

## What Does This Example Do?

Build a production-ready Gin application that implements warm transfer—seamlessly moving an active call from one agent to another while maintaining conversation context. This tutorial demonstrates the Telnyx Call Control API's transfer capabilities, webhook event handling, and proper state management for multi-party call scenarios.

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
- A Telnyx phone number enabled for inbound and outbound calls.
- A Call Control Application configured in the Telnyx Portal with a webhook URL.
- ngrok or similar tool to expose your local server for webhook testing.
- Basic familiarity with Go, Gin, and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/warm-transfer-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `models/call_state.go` to manage in-memory call state:

```go
package models

import "sync"

// CallState tracks active calls and their transfer status.
type CallState struct {
	CallControlID string
	FromNumber    string
	ToNumber      string
	Status        string // "active", "transferring", "transferred"
	OriginalAgent string
	TransferAgent string
	mu            sync.RWMutex
}

// CallStore manages all active calls.
type CallStore struct {
	calls map[string]*CallState
	mu    sync.RWMutex
}

// NewCallStore creates a new call store.
func NewCallStore() *CallStore {
	return &CallStore{
		calls: make(map[string]*CallState),
	}
}

// Add stores a new call.
func (cs *CallStore) Add(callControlID string, state *CallState) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.calls[callControlID] = state
}

// Get retrieves a call by ID.
func (cs *CallStore) Get(callControlID string) *CallState {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	return cs.calls[callControlID]
}

// Update modifies an existing call.
func (cs *CallStore) Update(callControlID string, state *CallState) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.calls[callControlID] = state
}

// Delete removes a call.
func (cs *CallStore) Delete(callControlID string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	delete(cs.calls, callControlID)
}
```

Create `handlers/calls.go` to implement call control logic:

```go
package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4"
	"github.com/team-telnyx/telnyx-go/v4/v2"
	"telnyx-warm-transfer/models"
)

// InitiateCallRequest represents the request to initiate a call.
type InitiateCallRequest struct {
	ToNumber string `json:"to" binding:"required"`
}

// TransferCallRequest represents the request to transfer a call.
type TransferCallRequest struct {
	CallControlID string `json:"call_control_id" binding:"required"`
	TransferTo    string `json:"transfer_to" binding:"required"`
}

// WebhookPayload represents the structure of incoming webhook events.
type WebhookPayload struct {
	Data struct {
		EventType     string `json:"event_type"`
		CallControlID string `json:"call_control_id"`
		From          string `json:"from"`
		To            string `json:"to"`
		State         string `json:"state"`
	} `json:"data"`
}

// CallHandlers holds dependencies for call operations.
type CallHandlers struct {
	Client    *telnyx.Client
	CallStore *models.CallStore
}

// NewCallHandlers creates a new CallHandlers instance.
func NewCallHandlers(client *telnyx.Client, callStore *models.CallStore) *CallHandlers {
	return &CallHandlers{
		Client:    client,
		CallStore: callStore,
	}
}

// InitiateCall handles outbound call initiation.
func (ch *CallHandlers) InitiateCall(c *gin.Context) {
	var req InitiateCallRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required field: 'to'"})
		return
	}

	fromNumber := os.Getenv("TELNYX_PHONE_NUMBER")
	connectionID := os.Getenv("TELNYX_CONNECTION_ID")

	if fromNumber == "" || connectionID == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Missing environment variables"})
		return
	}

	// Validate E.164 format.
	if req.ToNumber == "" || req.ToNumber[0] != '+' {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number must be in E.164 format"})
		return
	}

	// Initiate the call using the Telnyx SDK.
	response, err := ch.Client.Calls.Dial(&telnyx.CallDialRequest{
		From:         fromNumber,
		To:           req.ToNumber,
		ConnectionID: connectionID,
	})

	if err != nil {
		handleTelnyxError(c, err)
		return
	}

	// Store call state.
	callState := &models.CallState{
		CallControlID: response.Data.CallControlID,
		FromNumber:    fromNumber,
		ToNumber:      req.ToNumber,
		Status:        "active",
		OriginalAgent: fromNumber,
	}
	ch.CallStore.Add(response.Data.CallControlID, callState)

	c.JSON(http.StatusOK, gin.H{
		"call_control_id": response.Data.CallControlID,
		"from":            fromNumber,
		"to":              req.ToNumber,
		"status":          "initiated",
	})
}

// TransferCall handles warm transfer to another agent.
func (ch *CallHandlers) TransferCall(c *gin.Context) {
	var req TransferCallRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields: 'call_control_id', 'transfer_to'"})
		return
	}

	// Retrieve call state.
	callState := ch.CallStore.Get(req.CallControlID)
	if callState == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Call not found"})
		return
	}

	// Validate transfer target.
	if req.TransferTo == "" || req.TransferTo[0] != '+' {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Transfer target must be in E.164 format"})
		return
	}

	// Update call state to indicate transfer in progress.
	callState.Status = "transferring"
	callState.TransferAgent = req.TransferTo
	ch.CallStore.Update(req.CallControlID, callState)

	// Execute the transfer using the Telnyx SDK.
	_, err := ch.Client.Calls.Actions.Transfer(req.CallControlID, &telnyx.CallTransferRequest{
		To: req.TransferTo,
	})

	if err != nil {
		handleTelnyxError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"call_control_id": req.CallControlID,
		"status":          "transferred",
		"transfer_to":     req.TransferTo,
	})
}

// HandleWebhook processes incoming call control webhooks.
func (ch *CallHandlers) HandleWebhook(c *gin.Context) {
	var payload WebhookPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	callControlID := payload.Data.CallControlID
	eventType := payload.Data.EventType

	// Retrieve or initialize call state.
	callState := ch.CallStore.Get(callControlID)
	if callState == nil {
		callState = &models.CallState{
			CallControlID: callControlID,
			FromNumber:    payload.Data.From,
			ToNumber:      payload.Data.To,
			Status:        "active",
		}
	}

	// Update call state based on event type.
	switch eventType {
	case "call.initiated":
		callState.Status = "active"
	case "call.answered":
		callState.Status = "active"
	case "call.hangup":
		callState.Status = "ended"
		ch.CallStore.Delete(callControlID)
	case "call.transferred":
		callState.Status = "transferred"
	}

	ch.CallStore.Update(callControlID, callState)

	// Log the event for debugging.
	fmt.Printf("Webhook event: %s for call %s\n", eventType, callControlID)

	c.JSON(http.StatusOK, gin.H{"status": "received"})
}

// GetCallStatus retrieves the current status of a call.
func (ch *CallHandlers) GetCallStatus(c *gin.Context) {
	callControlID := c.Param("call_control_id")

	callState := ch.CallStore.Get(callControlID)
	if callState == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Call not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"call_control_id": callState.CallControlID,
		"from":            callState.FromNumber,
		"to":              callState.ToNumber,
		"status":          callState.Status,
		"original_agent":  callState.OriginalAgent,
		"transfer_agent":  callState.TransferAgent,
	})
}

// handleTelnyxError maps Telnyx SDK errors to HTTP status codes.
func handleTelnyxError(c *gin.Context, err error) {
	switch err.(type) {
	case *telnyx.AuthenticationError:
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
	case *telnyx.RateLimitError:
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
	case *telnyx.APIStatusError:
		apiErr := err.(*telnyx.APIStatusError)
		c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error()})
	case *telnyx.APIConnectionError:
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
	}
}
```

Create `main.go` to set up the Gin server:

```go
package main

import (
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4"
	"telnyx-warm-transfer/handlers"
	"telnyx-warm-transfer/models"
)

func main() {
	// Load environment variables from .env file.
	godotenv.Load()

	// Initialize Telnyx client.
	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		panic("TELNYX_API_KEY environment variable not set")
	}

	client := telnyx.NewClient(telnyx.WithAPIKey(apiKey))

	// Initialize call store and handlers.
	callStore := models.NewCallStore()
	callHandlers := handlers.NewCallHandlers(client, callStore)

	// Set up Gin router.
	router := gin.Default()

	// Define routes.
	router.POST("/calls/initiate", callHandlers.InitiateCall)
	router.POST("/calls/transfer", callHandlers.TransferCall)
	router.POST("/webhooks/call-control", callHandlers.HandleWebhook)
	router.GET("/calls/:call_control_id/status", callHandlers.GetCallStatus)

	// Start server.
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	router.Run(":" + port)
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Go server. |
| Call Not Found (404) | The transfer endpoint returns `{"error": "Call not found"}` when attempting to transfer. | Ensure the `call_control_id` from the initiate call response is used exactly in the transfer request. Call state is stored in memory; if the server restarts, all call state is lost. For production, use a persistent database like Redis or PostgreSQL. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl commands to use properly formatted numbers. |
| Webhook Not Received | The `/webhooks/call-control` endpoint is not receiving events from Telnyx. | Verify that ngrok is running and the webhook URL in your Call Control Application settings matches your ngrok URL exactly (e.g., `https://abc123.ngrok.io/webhooks/call-control`). Check that your firewall allows inbound HTTPS traffic on port 8080. Review Telnyx Portal logs to confirm webhook delivery attempts. |
| Missing Environment Variables | The application panics with "TELNYX_API_KEY environment variable not set" on startup. | Confirm your `.env` file exists in the same directory as `main.go` and contains all required variables: `TELNYX_API_KEY`, `TELNYX_PHONE_NUMBER`, `TELNYX_CONNECTION_ID`. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `godotenv.Load()` call must execute before `os.Getenv()` is called. |

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

- [Implement an IVR Menu with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/ivr-menu).
- [Record Calls with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/call-recording).
- [Build a Conference Call System with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/conference-call).
