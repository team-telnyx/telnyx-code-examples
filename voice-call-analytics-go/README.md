# Call Analytics with Go and Gin

## What Does This Example Do?

Build a production-ready Gin web service that tracks call metrics and analytics using the Telnyx Voice API. This tutorial demonstrates how to initiate outbound calls, receive webhook events, store call data, and expose analytics endpoints. You'll learn the command-event model of Telnyx Call Control, proper error handling for telecom APIs, and how to structure a real-world call tracking system.

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
- A Telnyx Call Control Application with a connection ID.
- A publicly accessible URL for receiving webhooks (ngrok or similar for local development).
- Basic familiarity with Go, REST APIs, and JSON.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voice-call-analytics-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `models.go` file to define data structures for call tracking:

```go
package main

import "time"

// CallRecord represents a single call in our analytics system.
type CallRecord struct {
	CallControlID string    `json:"call_control_id"`
	FromNumber    string    `json:"from_number"`
	ToNumber      string    `json:"to_number"`
	Status        string    `json:"status"`
	StartTime     time.Time `json:"start_time"`
	EndTime       *time.Time `json:"end_time,omitempty"`
	Duration      int       `json:"duration_seconds"`
	RecordingURL  string    `json:"recording_url,omitempty"`
}

// WebhookPayload represents the structure of Telnyx webhook events.
type WebhookPayload struct {
	Data struct {
		EventType     string `json:"event_type"`
		CallControlID string `json:"call_control_id"`
		From          string `json:"from"`
		To            string `json:"to"`
		State         string `json:"state"`
		RecordingURLs []struct {
			URL string `json:"url"`
		} `json:"recording_urls"`
	} `json:"data"`
}

// CallAnalytics represents aggregated call metrics.
type CallAnalytics struct {
	TotalCalls      int     `json:"total_calls"`
	CompletedCalls  int     `json:"completed_calls"`
	FailedCalls     int     `json:"failed_calls"`
	AverageDuration float64 `json:"average_duration_seconds"`
	RecordedCalls   int     `json:"recorded_calls"`
}
```

Create a `storage.go` file to manage in-memory call storage (use a database in production):

```go
package main

import (
	"sync"
	"time"
)

// CallStore manages call records with thread-safe operations.
type CallStore struct {
	mu    sync.RWMutex
	calls map[string]*CallRecord
}

func NewCallStore() *CallStore {
	return &CallStore{
		calls: make(map[string]*CallRecord),
	}
}

func (cs *CallStore) Create(callControlID, fromNumber, toNumber string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	cs.calls[callControlID] = &CallRecord{
		CallControlID: callControlID,
		FromNumber:    fromNumber,
		ToNumber:      toNumber,
		Status:        "initiated",
		StartTime:     time.Now(),
		Duration:      0,
	}
}

func (cs *CallStore) Update(callControlID, status string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	if call, exists := cs.calls[callControlID]; exists {
		call.Status = status
		if status == "completed" || status == "failed" {
			now := time.Now()
			call.EndTime = &now
			call.Duration = int(now.Sub(call.StartTime).Seconds())
		}
	}
}

func (cs *CallStore) AddRecording(callControlID, recordingURL string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	if call, exists := cs.calls[callControlID]; exists {
		call.RecordingURL = recordingURL
	}
}

func (cs *CallStore) Get(callControlID string) *CallRecord {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	return cs.calls[callControlID]
}

func (cs *CallStore) GetAll() []*CallRecord {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	records := make([]*CallRecord, 0, len(cs.calls))
	for _, call := range cs.calls {
		records = append(records, call)
	}
	return records
}

func (cs *CallStore) GetAnalytics() *CallAnalytics {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	analytics := &CallAnalytics{}
	var totalDuration int

	for _, call := range cs.calls {
		analytics.TotalCalls++
		if call.Status == "completed" {
			analytics.CompletedCalls++
			totalDuration += call.Duration
		} else if call.Status == "failed" {
			analytics.FailedCalls++
		}
		if call.RecordingURL != "" {
			analytics.RecordedCalls++
		}
	}

	if analytics.CompletedCalls > 0 {
		analytics.AverageDuration = float64(totalDuration) / float64(analytics.CompletedCalls)
	}

	return analytics
}
```

Create a `handlers.go` file with HTTP route handlers:

```go
package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4/v2"
)

// InitiateCallRequest represents the JSON payload for initiating a call.
type InitiateCallRequest struct {
	ToNumber string `json:"to_number" binding:"required"`
}

// InitiateCallHandler starts an outbound call and records it in the store.
func InitiateCallHandler(client *telnyx.Client, store *CallStore, config *Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req InitiateCallRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required field: to_number"})
			return
		}

		// Validate E.164 format
		if len(req.ToNumber) == 0 || req.ToNumber[0] != '+' {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number must be in E.164 format (e.g., +15551234567)"})
			return
		}

		// Initiate the call via Telnyx API
		response, err := client.Calls.Dial(&telnyx.CallDialRequest{
			From:         config.PhoneNumber,
			To:           req.ToNumber,
			ConnectionID: config.ConnectionID,
		})

		// Handle Telnyx API errors
		if err != nil {
			switch err.(type) {
			case *telnyx.AuthenticationError:
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
			case *telnyx.RateLimitError:
				c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
			case *telnyx.APIStatusError:
				statusErr := err.(*telnyx.APIStatusError)
				c.JSON(statusErr.StatusCode, gin.H{"error": err.Error(), "status_code": statusErr.StatusCode})
			case *telnyx.APIConnectionError:
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to initiate call"})
			}
			return
		}

		// Extract call control ID from response and store the call record
		callControlID := response.Data.CallControlID
		store.Create(callControlID, config.PhoneNumber, req.ToNumber)

		c.JSON(http.StatusOK, gin.H{
			"call_control_id": callControlID,
			"from_number":     config.PhoneNumber,
			"to_number":       req.ToNumber,
			"status":          "initiated",
		})
	}
}

// WebhookHandler processes incoming Telnyx call events.
func WebhookHandler(store *CallStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var payload WebhookPayload
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
			return
		}

		callControlID := payload.Data.CallControlID
		eventType := payload.Data.EventType

		// Update call status based on event type
		switch eventType {
		case "call.initiated":
			store.Update(callControlID, "initiated")
		case "call.answered":
			store.Update(callControlID, "answered")
		case "call.hangup":
			store.Update(callControlID, "completed")
		case "call.recording.saved":
			if len(payload.Data.RecordingURLs) > 0 {
				store.AddRecording(callControlID, payload.Data.RecordingURLs[0].URL)
			}
		}

		c.JSON(http.StatusOK, gin.H{"status": "received"})
	}
}

// GetCallStatusHandler retrieves the status of a specific call.
func GetCallStatusHandler(store *CallStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		callControlID := c.Param("call_control_id")
		call := store.Get(callControlID)

		if call == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Call not found"})
			return
		}

		c.JSON(http.StatusOK, call)
	}
}

// GetCallsHandler retrieves all recorded calls.
func GetCallsHandler(store *CallStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		calls := store.GetAll()
		c.JSON(http.StatusOK, calls)
	}
}

// GetAnalyticsHandler returns aggregated call analytics.
func GetAnalyticsHandler(store *CallStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		analytics := store.GetAnalytics()
		c.JSON(http.StatusOK, analytics)
	}
}
```

Create the main `main.go` file to set up the Gin server and routes:

```go
package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4/v2"
	"github.com/team-telnyx/telnyx-go/v4/v2/option"
)

func main() {
	// Load configuration from environment
	config := LoadConfig()

	// Validate required environment variables
	if config.APIKey == "" || config.PhoneNumber == "" || config.ConnectionID == "" {
		log.Fatal("Missing required environment variables: TELNYX_API_KEY, TELNYX_PHONE_NUMBER, TELNYX_CONNECTION_ID")
	}

	// Initialize Telnyx client with API key
	client := telnyx.NewClient(option.WithAPIKey(config.APIKey))

	// Initialize in-memory call store
	store := NewCallStore()

	// Create Gin router
	router := gin.Default()

	// Define routes
	router.POST("/calls/initiate", InitiateCallHandler(client, store, config))
	router.POST("/webhooks/call", WebhookHandler(store))
	router.GET("/calls/:call_control_id", GetCallStatusHandler(store))
	router.GET("/calls", GetCallsHandler(store))
	router.GET("/analytics", GetAnalyticsHandler(store))

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Start server
	log.Printf("Starting server on port %s\n", config.Port)
	if err := router.Run(":" + config.Port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voice-call-analytics-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or newlines. If the key was regenerated recently, update your environment file and restart the Go server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl request to use properly formatted numbers. |
| Missing Connection ID | The API returns a 422 error or "connection_id not found" message. | Verify that `TELNYX_CONNECTION_ID` in your `.env` file matches a valid Call Control Application ID from the [Telnyx Portal](https://portal.telnyx.com). The connection ID links your phone number to your Call Control application. Create a new application if needed and update the environment variable. |
| Webhooks Not Received | Call events are initiated but webhook handler is never called. | Ensure your webhook URL is publicly accessible and configured in the Telnyx Portal under your Call Control Application settings. For local testing, use ngrok to expose your local server: `ngrok http 8080`. Update the `WEBHOOK_URL` in your `.env` file and configure it in the Portal. Verify firewall rules allow inbound HTTPS traffic on port 443. |
| Call Store Returns Empty | `/calls` endpoint returns an empty array even after initiating calls. | Confirm that the `/calls/initiate` endpoint returned a successful response with a `call_control_id`. The call record is created in memory when the API call succeeds. If the server restarts, all in-memory data is lost. For production, use a persistent database instead of the in-memory map. |

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

- [Receive Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/inbound-call-webhook).
- [Record and Store Call Audio](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/call-recording).
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/call-transfer).
