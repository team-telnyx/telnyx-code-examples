# MMS Send with Go and Gin

## What Does This Example Do?

Build a production-ready Gin endpoint that sends MMS messages with media attachments using the Telnyx Go SDK. This tutorial demonstrates the client initialization pattern, proper error handling for telecom APIs, secure credential management via environment variables, and how to attach media URLs to outbound messages.

## Who Is This For?

- **Go developers** building sms features with Gin.
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
- A Telnyx phone number enabled for outbound MMS.
- A publicly accessible URL hosting media files (images, videos, or documents).
- go get (Go package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` and initialize the Telnyx client using the Go SDK pattern. Define a helper function to handle MMS creation with media URLs and proper validation:

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

// Initialize client with the Go SDK pattern
var client *telnyx.Client

func init() {
	// Load environment variables from .env file
	godotenv.Load()

	// Initialize Telnyx client with API key from environment
	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		panic("TELNYX_API_KEY environment variable not set")
	}

	client = telnyx.NewClient(telnyx.WithAPIKey(apiKey))
}

// SendMMSRequest represents the incoming HTTP request payload
type SendMMSRequest struct {
	To       string   `json:"to" binding:"required"`
	Message  string   `json:"message" binding:"required"`
	MediaURLs []string `json:"media_urls" binding:"required"`
}

// SendMMSResponse represents the JSON-serializable response
type SendMMSResponse struct {
	MessageID string `json:"message_id"`
	Status    string `json:"status"`
	From      string `json:"from"`
	To        string `json:"to"`
	MediaURLs []string `json:"media_urls"`
}

// sendMMS sends an MMS message via Telnyx and returns serializable response data
func sendMMS(toNumber string, message string, mediaURLs []string) (*SendMMSResponse, error) {
	fromNumber := os.Getenv("TELNYX_PHONE_NUMBER")
	if fromNumber == "" {
		return nil, fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}

	// Validate E.164 format to prevent API errors
	if !strings.HasPrefix(toNumber, "+") {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Validate media URLs are provided
	if len(mediaURLs) == 0 {
		return nil, fmt.Errorf("at least one media URL is required for MMS")
	}

	// Create MMS message with media URLs
	params := &telnyx.MessageCreateParams{
		From:      fromNumber,
		To:        toNumber,
		Text:      message,
		MediaURLs: mediaURLs,
	}

	response, err := client.Messages.Create(params)
	if err != nil {
		return nil, err
	}

	// Extract serializable data — SDK objects are NOT JSON-serializable
	status := "unknown"
	if response.Data != nil && len(response.Data.To) > 0 {
		status = response.Data.To[0].Status
	}

	return &SendMMSResponse{
		MessageID: response.Data.ID,
		Status:    status,
		From:      fromNumber,
		To:        toNumber,
		MediaURLs: mediaURLs,
	}, nil
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-mms-picture-message-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Gin server. |
| Invalid Phone Number Format | You receive a 400 error stating "phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Media URL Not Accessible | The API returns an error about invalid or unreachable media URLs. | Verify that all URLs in the `media_urls` array are publicly accessible and return valid media files (JPEG, PNG, GIF, MP4, etc.). Test the URLs in your browser to confirm they load. Ensure the URLs use HTTPS where required and do not have authentication restrictions. |
| Missing Media URLs | The endpoint returns `{"error": "at least one media URL is required for MMS"}` with HTTP 400. | Confirm that your request JSON includes the `media_urls` field as an array with at least one valid URL. Example: `"media_urls": ["https://example.com/image.jpg"]`. The field is required for MMS; use SMS instead if you only have text. |
| Environment Variable Not Set | The application panics with `TELNYX_API_KEY environment variable not set` on startup. | Confirm your `.env` file exists in the same directory as `main.go` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `godotenv.Load()` call must execute before `os.Getenv()` is called—verify this import order in your code. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Go version do I need?**

Go 1.22 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Send a Single SMS with Go and Gin](/tutorials/sms/go/send-single-sms).
- [Send Bulk SMS Messages with Go](/tutorials/sms/go/send-bulk-sms).
- [Receive SMS Webhooks with Go](/tutorials/sms/go/receive-sms-webhook).
