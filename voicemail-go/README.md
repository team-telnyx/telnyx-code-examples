# Voicemail with Go and Gin

## What Does This Example Do?

Build a production-ready voicemail system using the Telnyx Voice API and Go with the Gin framework. This tutorial demonstrates how to handle inbound calls, record voicemail messages, and retrieve recordings using the Telnyx Go SDK. You'll learn the command-event model for call control, webhook handling, and secure credential management via environment variables.

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
- A Call Control Application configured in the Telnyx Portal with a webhook URL pointing to your server.
- `go get` (Go package manager).
- A publicly accessible URL for receiving webhooks (use ngrok for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voicemail-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `voicemail.go` to handle voicemail logic:

```go
package main

import (
	"fmt"
	"log"

	"github.com/team-telnyx/telnyx-go/v4/v2"
	"github.com/team-telnyx/telnyx-go/v4/v2/call"
)

type VoicemailService struct {
	client *telnyx.Client
	config *Config
}

func NewVoicemailService(client *telnyx.Client, config *Config) *VoicemailService {
	return &VoicemailService{
		client: client,
		config: config,
	}
}

// AnswerCall answers an inbound call and plays a greeting message.
func (vs *VoicemailService) AnswerCall(callControlID string) error {
	params := &call.AnswerParams{}
	_, err := vs.client.Calls.Answer(callControlID, params)
	if err != nil {
		log.Printf("Error answering call %s: %v", callControlID, err)
		return err
	}
	return nil
}

// PlayGreeting plays a TTS greeting message before recording voicemail.
func (vs *VoicemailService) PlayGreeting(callControlID string) error {
	params := &call.SpeakParams{
		Payload: "Please leave your message after the beep. Press pound when finished.",
		Voice:   "female",
		Language: "en-US",
	}
	_, err := vs.client.Calls.Speak(callControlID, params)
	if err != nil {
		log.Printf("Error playing greeting for call %s: %v", callControlID, err)
		return err
	}
	return nil
}

// StartRecording begins recording the voicemail message.
func (vs *VoicemailService) StartRecording(callControlID string) error {
	params := &call.StartRecordingParams{
		Format: "wav",
	}
	_, err := vs.client.Calls.StartRecording(callControlID, params)
	if err != nil {
		log.Printf("Error starting recording for call %s: %v", callControlID, err)
		return err
	}
	return nil
}

// StopRecording stops the voicemail recording.
func (vs *VoicemailService) StopRecording(callControlID string) error {
	params := &call.StopRecordingParams{}
	_, err := vs.client.Calls.StopRecording(callControlID, params)
	if err != nil {
		log.Printf("Error stopping recording for call %s: %v", callControlID, err)
		return err
	}
	return nil
}

// HangupCall terminates the call.
func (vs *VoicemailService) HangupCall(callControlID string) error {
	params := &call.HangupParams{}
	_, err := vs.client.Calls.Hangup(callControlID, params)
	if err != nil {
		log.Printf("Error hanging up call %s: %v", callControlID, err)
		return err
	}
	return nil
}
```

Create `handlers.go` to define HTTP endpoints:

```go
package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4/v2"
)

type WebhookPayload struct {
	Data struct {
		EventType      string `json:"event_type"`
		CallControlID  string `json:"call_control_id"`
		From           string `json:"from"`
		To             string `json:"to"`
		RecordingURL   string `json:"recording_urls"`
		State          string `json:"state"`
	} `json:"data"`
}

type CallInitRequest struct {
	To string `json:"to" binding:"required"`
}

type RecordingResponse struct {
	CallControlID string `json:"call_control_id"`
	RecordingURL  string `json:"recording_url"`
	Status        string `json:"status"`
}

// HandleWebhook processes incoming call control webhooks.
func HandleWebhook(vs *VoicemailService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var payload WebhookPayload
		if err := c.ShouldBindJSON(&payload); err != nil {
			log.Printf("Invalid webhook payload: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid payload"})
			return
		}

		callControlID := payload.Data.CallControlID
		eventType := payload.Data.EventType

		log.Printf("Received webhook: event_type=%s, call_control_id=%s", eventType, callControlID)

		// Handle different call events
		switch eventType {
		case "call.initiated":
			// Answer the inbound call
			if err := vs.AnswerCall(callControlID); err != nil {
				log.Printf("Failed to answer call: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to answer call"})
				return
			}

		case "call.answered":
			// Play greeting and start recording
			if err := vs.PlayGreeting(callControlID); err != nil {
				log.Printf("Failed to play greeting: %v", err)
			}
			if err := vs.StartRecording(callControlID); err != nil {
				log.Printf("Failed to start recording: %v", err)
			}

		case "call.dtmf.received":
			// Stop recording when caller presses # (pound)
			if err := vs.StopRecording(callControlID); err != nil {
				log.Printf("Failed to stop recording: %v", err)
			}
			if err := vs.HangupCall(callControlID); err != nil {
				log.Printf("Failed to hangup call: %v", err)
			}

		case "call.recording.saved":
			// Recording is ready — log the URL for retrieval
			log.Printf("Recording saved for call %s: %s", callControlID, payload.Data.RecordingURL)

		case "call.hangup":
			// Call ended — clean up resources
			log.Printf("Call %s ended", callControlID)

		default:
			log.Printf("Unhandled event type: %s", eventType)
		}

		c.JSON(http.StatusOK, gin.H{"status": "received"})
	}
}

// HandleInitiateCall initiates an outbound call (optional — for testing).
func HandleInitiateCall(vs *VoicemailService, config *Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CallInitRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required field: 'to'"})
			return
		}

		// Validate E.164 format
		if len(req.To) == 0 || req.To[0] != '+' {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number must be in E.164 format (e.g., +15551234567)"})
			return
		}

		// Create client and initiate call
		client := telnyx.NewClient(telnyx.WithAPIKey(config.APIKey))

		dialParams := &telnyx.CallDialParams{
			From:         config.PhoneNumber,
			To:           req.To,
			ConnectionID: config.ConnectionID,
		}

		response, err := client.Calls.Dial(dialParams)
		if err != nil {
			handleCallError(c, err)
			return
		}

		// Extract serializable data
		result := map[string]interface{}{
			"call_control_id": response.Data.CallControlID,
			"from":            response.Data.From,
			"to":              response.Data.To,
			"state":           response.Data.State,
		}

		c.JSON(http.StatusOK, result)
	}
}

// handleCallError maps Telnyx SDK errors to HTTP status codes.
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
	}
}
```

Create `main.go` to set up the Gin server:

```go
package main

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4/v2"
)

func main() {
	// Load configuration
	config, err := LoadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	// Initialize Telnyx client
	client := telnyx.NewClient(telnyx.WithAPIKey(config.APIKey))

	// Create voicemail service
	voicemailService := NewVoicemailService(client, config)

	// Set up Gin router
	router := gin.Default()

	// Webhook endpoint for call control events
	router.POST("/webhooks/call", HandleWebhook(voicemailService))

	// Optional: endpoint to initiate outbound calls
	router.POST("/calls/initiate", HandleInitiateCall(voicemailService, config))

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Start server
	log.Printf("Starting voicemail server on port %s", config.Port)
	if err := router.Run(":" + config.Port); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voicemail-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Go server. |
| Webhook Not Received | The `/webhooks/call` endpoint is never called when inbound calls arrive. | Confirm your Call Control Application webhook URL in the Telnyx Portal is set to your public ngrok URL (e.g., `https://abc123.ngrok.io/webhooks/call`). Verify ngrok is running and the tunnel is active. Check your firewall and router settings to ensure inbound traffic is allowed. |
| Call Not Answered | Inbound calls ring but are not answered by the voicemail system. | Ensure the `call.initiated` webhook event triggers the `AnswerCall` function. Check the Telnyx Portal logs for webhook delivery failures. Verify your `TELNYX_CONNECTION_ID` is correct and matches the Call Control Application ID. Confirm the application is linked to your Telnyx phone number. |
| Recording Not Saved | The `call.recording.saved` event is not received or the recording URL is empty. | Verify the `StartRecording` call succeeds before the caller hangs up. Ensure the call duration is at least a few seconds. Check that the recording format (`wav`) is supported. Review Telnyx Portal logs for any recording errors. Confirm your webhook endpoint returns HTTP 200 to acknowledge receipt. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |

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

- [Handle Inbound Calls with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/inbound-call-webhook).
- [Record and Retrieve Call Recordings](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/call-recording).
- [Build an IVR Menu with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/ivr-menu).
