# Conference Call with Go and Gin

## What Does This Example Do?

Build a production-ready Gin web service that manages multi-participant conference calls using the Telnyx Voice API. This tutorial demonstrates how to initiate calls, add participants to a conference, handle real-time call events via webhooks, and manage conference state. You'll learn the command-event model of Telnyx Call Control, proper error handling for telecom APIs, and secure credential management via environment variables.

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
- A Call Control Application configured in the Telnyx Portal with its Connection ID.
- A publicly accessible webhook URL (use ngrok for local development).
- Basic familiarity with Go, Gin, and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-conference-calling-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-conference-calling-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `handlers/conference.go` to implement conference management logic:

```go
package handlers

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2"
	"telnyx-conference/models"
	"telnyx-conference/utils"
)

// ConferenceManager tracks active conferences and participants.
type ConferenceManager struct {
	mu         sync.RWMutex
	sessions   map[string]*models.ConferenceSession
	callToConf map[string]string // Maps call_control_id to conference_id
}

var conferenceManager = &ConferenceManager{
	sessions:   make(map[string]*models.ConferenceSession),
	callToConf: make(map[string]string),
}

// InitiateCall initiates an outbound call and adds it to a conference.
func InitiateCall(cfg *utils.Config, client *telnyx.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.CallInitRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required field: 'to'"})
			return
		}

		// Validate E.164 format
		if len(req.To) == 0 || req.To[0] != '+' {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number must be in E.164 format (e.g., +15551234567)"})
			return
		}

		// Generate or retrieve conference ID (simplified: use timestamp-based ID)
		conferenceID := fmt.Sprintf("conf_%d", time.Now().UnixNano())

		// Initiate the call using the Telnyx SDK
		dialResponse, err := client.Calls.Dial(
			&v2.CallDialRequest{
				From:         cfg.PhoneNumber,
				To:           req.To,
				ConnectionID: cfg.ConnectionID,
				CustomHeaders: []map[string]string{
					{
						"X-Conference-ID": conferenceID,
					},
				},
			},
		)

		if err != nil {
			handleTelnyxError(c, err)
			return
		}

		// Extract call_control_id from response
		callControlID := dialResponse.Data.CallControlID

		// Track the call-to-conference mapping
		conferenceManager.mu.Lock()
		conferenceManager.callToConf[callControlID] = conferenceID

		// Initialize conference session if not exists
		if _, exists := conferenceManager.sessions[conferenceID]; !exists {
			conferenceManager.sessions[conferenceID] = &models.ConferenceSession{
				ConferenceID: conferenceID,
				Participants: []string{},
				Status:       "initiated",
				CreatedAt:    time.Now().Format(time.RFC3339),
			}
		}

		// Add participant
		conferenceManager.sessions[conferenceID].Participants = append(
			conferenceManager.sessions[conferenceID].Participants,
			callControlID,
		)
		conferenceManager.mu.Unlock()

		c.JSON(http.StatusOK, models.CallInitResponse{
			CallControlID: callControlID,
			Status:        "initiated",
		})
	}
}

// GetConferenceStatus retrieves the status of an active conference.
func GetConferenceStatus(c *gin.Context) {
	conferenceID := c.Param("conference_id")

	conferenceManager.mu.RLock()
	session, exists := conferenceManager.sessions[conferenceID]
	conferenceManager.mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conference not found"})
		return
	}

	c.JSON(http.StatusOK, session)
}

// HandleWebhook processes incoming call events from Telnyx.
func HandleWebhook(c *gin.Context) {
	var event models.WebhookEvent
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	callControlID := event.Data.CallControlID
	eventType := event.Data.EventType

	conferenceManager.mu.Lock()
	defer conferenceManager.mu.Unlock()

	// Retrieve the conference ID for this call
	conferenceID, exists := conferenceManager.callToConf[callControlID]
	if !exists {
		// Event for unknown call; log and ignore
		c.JSON(http.StatusOK, gin.H{"status": "ignored"})
		return
	}

	session, sessionExists := conferenceManager.sessions[conferenceID]
	if !sessionExists {
		c.JSON(http.StatusOK, gin.H{"status": "ignored"})
		return
	}

	// Handle different event types
	switch eventType {
	case "call.answered":
		session.Status = "active"

	case "call.hangup":
		// Remove participant from conference
		for i, pid := range session.Participants {
			if pid == callControlID {
				session.Participants = append(session.Participants[:i], session.Participants[i+1:]...)
				break
			}
		}

		// Clean up mappings
		delete(conferenceManager.callToConf, callControlID)

		// If no participants remain, mark conference as ended
		if len(session.Participants) == 0 {
			session.Status = "ended"
		}

	case "call.initiated":
		// Call is being set up; no action needed yet

	default:
		// Ignore other event types
	}

	c.JSON(http.StatusOK, gin.H{"status": "processed"})
}

// handleTelnyxError maps Telnyx SDK errors to HTTP status codes.
func handleTelnyxError(c *gin.Context, err error) {
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
	}
}
```

Create `main.go` to set up the Gin server and routes:

```go
package main

import (
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/telnyx/telnyx-go"
	"telnyx-conference/handlers"
	"telnyx-conference/utils"
)

func main() {
	// Load configuration
	cfg, err := utils.LoadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	// Initialize Telnyx client
	client := telnyx.NewClient(telnyx.WithAPIKey(cfg.APIKey))

	// Create Gin router
	router := gin.Default()

	// Middleware to inject client into context
	router.Use(func(c *gin.Context) {
		c.Set("telnyx_client", client)
		c.Set("config", cfg)
		c.Next()
	})

	// Routes
	router.POST("/calls/initiate", handlers.InitiateCall(cfg, client))
	router.GET("/conferences/:conference_id", handlers.GetConferenceStatus)
	router.POST("/webhooks/call", handlers.HandleWebhook)

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Start server
	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("Starting server on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conference-calling-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or newlines. If the key was regenerated recently, update your environment file and restart the Go server. Run `go run main.go` to confirm the new key is loaded. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. Verify the `TELNYX_PHONE_NUMBER` in your `.env` file is also in E.164 format. |
| Connection ID Not Found | The API returns an error about an invalid or missing connection ID. | Verify your `TELNYX_CONNECTION_ID` in the `.env` file matches a Call Control Application ID from the [Telnyx Portal](https://portal.telnyx.com). Navigate to Call Control Applications, copy the exact Connection ID, and ensure there are no extra spaces. Restart the server after updating the `.env` file. |
| Webhook Events Not Received | The `/webhooks/call` endpoint is not receiving events from Telnyx. | Ensure your webhook URL is publicly accessible. Use ngrok to expose your local server: `ngrok http 8080`. Update the `WEBHOOK_URL` in your `.env` file with the ngrok URL. Configure this URL in your Telnyx Call Control Application settings in the Portal under "Webhook URL". Verify the server is running and listening on the correct port. Check your firewall and router settings to ensure inbound traffic is allowed. |
| Conference Not Found | The `/conferences/:conference_id` endpoint returns a 404 error. | Verify you are using the correct conference ID returned from the `/calls/initiate` endpoint. Conference IDs are generated with a `conf_` prefix followed by a timestamp. Ensure the conference was created recently and has not expired. Check that at least one participant is still active in the conference. |

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

- [Handle Inbound Calls with Webhooks](/tutorials/voice/go/inbound-call-webhook).
- [Record and Retrieve Call Recordings](/tutorials/voice/go/call-recording).
- [Transfer Calls Between Participants](/tutorials/voice/go/call-transfer).
