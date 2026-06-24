# Hold Music with Go and Gin

## What Does This Example Do?

Build a production-ready Gin application that implements hold music for inbound calls using the Telnyx Voice API. This tutorial demonstrates how to answer incoming calls, play audio during hold periods, and manage call state with proper error handling and webhook integration.

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
- A Call Control Application configured in the Telnyx Portal with webhook URL pointing to your server.
- A publicly accessible URL for receiving webhooks (use ngrok for local development).
- An audio file URL (MP3 or WAV) for hold music playback.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/hold-music-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` to initialize the Gin server and Telnyx client:

```go
package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4/v2"
	"github.com/team-telnyx/telnyx-go/v4/v2/client"
)

var telnyxClient *client.Client

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

	telnyxClient = client.NewClient(client.WithAPIKey(apiKey))
}

func main() {
	router := gin.Default()

	// Webhook endpoint for receiving call events
	router.POST("/webhooks/call", handleCallWebhook)

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting server on port %s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
```

Create `webhooks/call.go` to handle incoming call events:

```go
package webhooks

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4/v2/client"
)

// CallWebhookPayload represents the structure of incoming call webhooks
type CallWebhookPayload struct {
	Data struct {
		EventType      string `json:"event_type"`
		CallControlID  string `json:"call_control_id"`
		ConnectionID   string `json:"connection_id"`
		State          string `json:"state"`
		From           string `json:"from"`
		To             string `json:"to"`
		CallSessionID  string `json:"call_session_id"`
	} `json:"data"`
}

// HandleCallWebhook processes incoming call events from Telnyx
func HandleCallWebhook(telnyxClient *client.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var payload CallWebhookPayload

		// Parse incoming webhook JSON
		if err := c.ShouldBindJSON(&payload); err != nil {
			log.Printf("Failed to parse webhook: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
			return
		}

		eventType := payload.Data.EventType
		callControlID := payload.Data.CallControlID

		log.Printf("Received event: %s for call: %s", eventType, callControlID)

		// Handle different call events
		switch eventType {
		case "call.initiated":
			// Answer the incoming call
			if err := answerCall(telnyxClient, callControlID); err != nil {
				log.Printf("Failed to answer call: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to answer call"})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "call answered"})

		case "call.answered":
			// Play hold music after call is answered
			if err := playHoldMusic(telnyxClient, callControlID); err != nil {
				log.Printf("Failed to play hold music: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to play hold music"})
				return
			}
			c.JSON(http.StatusOK, gin.H{"status": "hold music playing"})

		case "call.hangup":
			// Clean up resources when call ends
			log.Printf("Call %s ended", callControlID)
			c.JSON(http.StatusOK, gin.H{"status": "call ended"})

		default:
			log.Printf("Unhandled event type: %s", eventType)
			c.JSON(http.StatusOK, gin.H{"status": "event received"})
		}
	}
}

// answerCall answers an incoming call
func answerCall(telnyxClient *client.Client, callControlID string) error {
	params := &client.CallAnswerParams{
		CallControlId: callControlID,
	}

	_, err := telnyxClient.Calls.Answer(params)
	if err != nil {
		return err
	}

	log.Printf("Call %s answered successfully", callControlID)
	return nil
}

// playHoldMusic plays hold music audio to the caller
func playHoldMusic(telnyxClient *client.Client, callControlID string) error {
	holdMusicURL := os.Getenv("HOLD_MUSIC_URL")
	if holdMusicURL == "" {
		return nil // Skip if no hold music URL configured
	}

	params := &client.CallPlayParams{
		CallControlId: callControlID,
		AudioUrl:      holdMusicURL,
	}

	_, err := telnyxClient.Calls.Play(params)
	if err != nil {
		return err
	}

	log.Printf("Hold music started for call %s", callControlID)
	return nil
}
```

Update `main.go` to wire the webhook handler:

```go
package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4/v2/client"
	"telnyx-hold-music/webhooks"
)

var telnyxClient *client.Client

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

	telnyxClient = client.NewClient(client.WithAPIKey(apiKey))
}

func main() {
	router := gin.Default()

	// Webhook endpoint for receiving call events
	router.POST("/webhooks/call", webhooks.HandleCallWebhook(telnyxClient))

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting server on port %s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hold-music-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | The application starts but no webhook events arrive when calling the phone number. | Verify your ngrok URL is correctly configured in the Telnyx Portal Call Control Application webhook settings. Ensure the webhook URL is exactly `https://<ngrok-url>/webhooks/call`. Check that your firewall allows inbound HTTPS traffic on port 8080. Restart ngrok and update the Portal if the URL changes. |
| Call not being answered | Incoming calls ring but are not automatically answered by the application. | Confirm `TELNYX_API_KEY` is valid and has permissions for call control operations. Verify the `call.initiated` event is being logged. Check that the `answerCall()` function is being invoked by adding debug logs. Ensure your Call Control Application is properly linked to your Telnyx phone number in the Portal. |
| Hold music not playing | Calls are answered but no audio is heard during the hold period. | Verify `HOLD_MUSIC_URL` environment variable is set and points to a valid, publicly accessible audio file (MP3 or WAV format). Test the URL directly in a browser to confirm it's accessible. Ensure the audio file is less than 5 minutes for optimal performance. Check application logs for errors from the `playHoldMusic()` function. |
| Authentication error (401) | The application logs show `AuthenticationError` or `Invalid API key` messages. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key from the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or special characters in the key. Regenerate the API key in the Portal if necessary and update your `.env` file. Restart the application after updating credentials. |
| Connection refused errors | The application fails to start with `connection refused` or port binding errors. | Ensure port 8080 is not already in use by another application. Change the `PORT` environment variable to an available port (e.g., 8081). On Linux/Mac, use `lsof -i :8080` to check what's using the port. Verify firewall rules allow the application to bind to the specified port. |

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

- [Handle Inbound Call Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/inbound-call-webhook).
- [Record Calls with Go and Gin](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/call-recording).
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/call-transfer).
