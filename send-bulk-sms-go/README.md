# Send Bulk SMS with Go and Gin

## What Does This Example Do?

Build a production-ready Gin endpoint that sends bulk SMS messages using the Telnyx Go SDK. This tutorial demonstrates concurrent message delivery with rate limiting, proper error handling for telecom APIs, and secure credential management via environment variables. You'll learn how to batch send SMS to multiple recipients while respecting API rate limits and handling failures gracefully.

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
- A Telnyx phone number enabled for outbound SMS.
- Basic familiarity with Go and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `bulk_sms.go` to handle the core bulk SMS logic with rate limiting and concurrency control:

```go
package main

import (
	"fmt"
	"sync"
	"time"

	"github.com/telnyx/telnyx-go/v2"
)

// MessageResult represents the outcome of a single SMS send attempt.
type MessageResult struct {
	To        string `json:"to"`
	MessageID string `json:"message_id,omitempty"`
	Status    string `json:"status"`
	Error     string `json:"error,omitempty"`
}

// BulkSMSRequest represents the incoming request payload.
type BulkSMSRequest struct {
	Recipients []string `json:"recipients"` // List of phone numbers in E.164 format
	Message    string   `json:"message"`
}

// SendBulkSMS sends SMS to multiple recipients with rate limiting and concurrency control.
// It returns a slice of MessageResult objects and any fatal error.
func SendBulkSMS(client *telnyx.Client, config *Config, req *BulkSMSRequest) ([]MessageResult, error) {
	if len(req.Recipients) == 0 {
		return nil, fmt.Errorf("recipients list cannot be empty")
	}

	if req.Message == "" {
		return nil, fmt.Errorf("message text cannot be empty")
	}

	results := make([]MessageResult, len(req.Recipients))
	resultsMutex := &sync.Mutex{}

	// Use a semaphore pattern to limit concurrent goroutines.
	semaphore := make(chan struct{}, config.MaxConcurrency)
	var wg sync.WaitGroup

	// Rate limiter: ticker ensures minimum delay between API calls.
	rateLimiter := time.NewTicker(config.RateLimitDelay)
	defer rateLimiter.Stop()

	for i, recipient := range req.Recipients {
		wg.Add(1)

		go func(index int, to string) {
			defer wg.Done()

			// Acquire semaphore slot.
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			// Wait for rate limiter tick.
			<-rateLimiter.C

			// Validate E.164 format.
			if len(to) == 0 || to[0] != '+' {
				resultsMutex.Lock()
				results[index] = MessageResult{
					To:     to,
					Status: "failed",
					Error:  "Phone number must be in E.164 format (e.g., +15551234567)",
				}
				resultsMutex.Unlock()
				return
			}

			// Send the message via Telnyx API.
			response, err := client.Messages.Create(&telnyx.MessageCreateParams{
				From: telnyx.String(config.TelnyxPhoneNum),
				To:   telnyx.String(to),
				Text: telnyx.String(req.Message),
			})

			resultsMutex.Lock()
			defer resultsMutex.Unlock()

			if err != nil {
				// Extract error details for the result.
				errorMsg := err.Error()
				results[index] = MessageResult{
					To:     to,
					Status: "failed",
					Error:  errorMsg,
				}
				return
			}

			// Extract serializable data from the response.
			status := "queued"
			if response.Data != nil && len(response.Data.To) > 0 {
				status = response.Data.To[0].Status
			}

			results[index] = MessageResult{
				To:        to,
				MessageID: response.Data.ID,
				Status:    status,
			}
		}(i, recipient)
	}

	wg.Wait()
	return results, nil
}
```

Create `main.go` to set up the Gin server with error handling:

```go
package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/telnyx/telnyx-go/v2"
	"github.com/telnyx/telnyx-go/v2/option"
)

func main() {
	// Load configuration from environment.
	config := LoadConfig()

	// Validate required configuration.
	if config.TelnyxAPIKey == "" {
		panic("TELNYX_API_KEY environment variable not set")
	}
	if config.TelnyxPhoneNum == "" {
		panic("TELNYX_PHONE_NUMBER environment variable not set")
	}

	// Initialize Telnyx client with API key.
	client := telnyx.NewClient(option.WithAPIKey(config.TelnyxAPIKey))

	// Create Gin router.
	router := gin.Default()

	// POST /sms/bulk - Send bulk SMS to multiple recipients.
	router.POST("/sms/bulk", func(c *gin.Context) {
		var req BulkSMSRequest

		// Parse JSON request body.
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid request body: " + err.Error(),
			})
			return
		}

		// Validate request fields.
		if len(req.Recipients) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Missing required field: 'recipients' (non-empty list)",
			})
			return
		}

		if req.Message == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Missing required field: 'message'",
			})
			return
		}

		// Send bulk SMS and handle errors.
		results, err := SendBulkSMS(client, config, &req)

		// Handle fatal errors (not per-message failures).
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
			})
			return
		}

		// Return results for all recipients.
		c.JSON(http.StatusOK, gin.H{
			"total":    len(results),
			"results":  results,
		})
	})

	// Health check endpoint.
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
		})
	})

	// Start the server on port 8080.
	router.Run(":8080")
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "..."}` with HTTP 401 or messages fail with authentication errors. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Go server. Run `echo $TELNYX_API_KEY` to confirm the variable is loaded. |
| Invalid Phone Number Format | Some recipients in the results show `"status": "failed"` with error "Phone number must be in E.164 format". | Ensure all phone numbers in the `recipients` array use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Rate Limiting / 429 Errors | Messages fail with "Rate limit exceeded" or HTTP 429 responses from Telnyx. | Reduce the `MaxConcurrency` value in `config.go` (try 2 or 3 instead of 5) and increase `RateLimitDelay` (try 200ms instead of 100ms). This slows down the request rate to respect Telnyx API limits. For very large bulk sends, consider implementing exponential backoff retry logic. |
| Empty Recipients List | The endpoint returns `{"error": "recipients list cannot be empty"}`. | Ensure your JSON request body includes a non-empty `recipients` array with at least one phone number. Example: `{"recipients": ["+15551234567"], "message": "Hello"}`. |
| Environment Variables Not Loaded | The application panics with "TELNYX_API_KEY environment variable not set" on startup. | Confirm your `.env` file exists in the same directory as the Go binary and contains the variables. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `godotenv.Load()` call must execute before `os.Getenv()` is called. Alternatively, set environment variables directly: `export TELNYX_API_KEY=your_key && go run main.go config.go bulk_sms.go`. |

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

- [Send a Single SMS with Go and Gin](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/send-single-sms).
- [Receive SMS Webhooks with Go and Gin](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/otp-2fa).
