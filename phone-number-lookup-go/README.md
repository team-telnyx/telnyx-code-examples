# Number Lookup with Go and Gin

## What Does This Example Do?

Build a production-ready Gin endpoint that performs number lookup queries using the Telnyx SMS API. This tutorial demonstrates how to retrieve detailed information about phone numbers, including carrier details, line type, and number portability status. You'll learn the new client-based initialization pattern, proper error handling for telecom APIs, and secure credential management via environment variables.

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

- Go 1.19 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- The Gin web framework and Telnyx Go SDK installed.
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/phone-number-lookup-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `lookup.go` file to handle number lookup logic:

```go
package main

import (
	"fmt"

	"github.com/team-telnyx/telnyx-go/v4/v2"
)

// NumberLookupResult represents the serializable response from a number lookup.
type NumberLookupResult struct {
	PhoneNumber      string `json:"phone_number"`
	Carrier          string `json:"carrier"`
	LineType         string `json:"line_type"`
	Country          string `json:"country"`
	PortedStatus     string `json:"ported_status"`
	LookupID         string `json:"lookup_id"`
	RequestID        string `json:"request_id"`
}

// PerformNumberLookup queries the Telnyx API for phone number details.
// This function does NOT handle exceptions — they are caught in the route handler.
func PerformNumberLookup(client *telnyx.Client, phoneNumber string) (*NumberLookupResult, error) {
	// Validate E.164 format to prevent API errors.
	if phoneNumber == "" {
		return nil, fmt.Errorf("phone number cannot be empty")
	}
	if phoneNumber[0] != '+' {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Call the number lookup API.
	// The SDK method signature: client.NumberLookups.Create(params)
	params := &telnyx.NumberLookupCreateParams{
		PhoneNumber: phoneNumber,
	}

	response, err := client.NumberLookups.Create(params)
	if err != nil {
		return nil, err
	}

	// Extract serializable data from the SDK response.
	// SDK objects are NOT JSON-serializable — always unpack to plain structs.
	result := &NumberLookupResult{
		PhoneNumber:  response.Data.PhoneNumber,
		Carrier:      response.Data.Carrier,
		LineType:     response.Data.LineType,
		Country:      response.Data.Country,
		PortedStatus: response.Data.PortedStatus,
		LookupID:     response.Data.ID,
		RequestID:    response.RequestID,
	}

	return result, nil
}
```

Create the main `main.go` file with Gin route handlers and error handling:

```go
package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4/v2"
)

func main() {
	// Initialize Telnyx client.
	client := LoadConfig()
	port := GetPort()

	// Create Gin router.
	router := gin.Default()

	// Register routes.
	router.POST("/lookup", func(c *gin.Context) {
		handleNumberLookup(c, client)
	})

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Start server.
	log.Printf("Starting server on port %s\n", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// handleNumberLookup is the HTTP route handler for number lookup requests.
// Exception handling is performed here, not in helper functions.
func handleNumberLookup(c *gin.Context, client *telnyx.Client) {
	// Parse JSON request body.
	var req struct {
		PhoneNumber string `json:"phone_number" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Missing required field: 'phone_number'",
		})
		return
	}

	// Call the lookup helper function.
	result, err := PerformNumberLookup(client, req.PhoneNumber)

	// Handle Telnyx SDK exceptions in the route handler.
	if err != nil {
		// Check for specific Telnyx error types.
		switch err.(type) {
		case *telnyx.AuthenticationError:
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid API key",
			})
			return

		case *telnyx.RateLimitError:
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded. Please slow down.",
			})
			return

		case *telnyx.APIStatusError:
			apiErr := err.(*telnyx.APIStatusError)
			c.JSON(apiErr.StatusCode, gin.H{
				"error":       apiErr.Error(),
				"status_code": apiErr.StatusCode,
			})
			return

		case *telnyx.APIConnectionError:
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "Network error connecting to Telnyx",
			})
			return

		default:
			// Handle validation errors (from PerformNumberLookup).
			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
			})
			return
		}
	}

	// Return successful lookup result.
	c.JSON(http.StatusOK, result)
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or newlines. If the key was regenerated recently, update your environment file and restart the Gin server with `go run main.go config.go lookup.go`. |
| Invalid Phone Number Format | You receive a 400 error stating "phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Environment Variable Not Set | The application exits with `TELNYX_API_KEY environment variable not set` on startup. | Confirm your `.env` file exists in the same directory as `main.go` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `godotenv.Load()` call must execute before `os.Getenv()` is called—verify this import order in your code. |
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API enforces rate limits on number lookup requests. Implement exponential backoff in your client code or reduce the frequency of lookups. For production use, consider batching lookups or caching results for frequently queried numbers. |
| Network Connection Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection and that the Telnyx API endpoint is reachable. Check if your firewall or proxy is blocking outbound HTTPS connections to `api.telnyx.com`. Temporarily disable VPN or proxy software and retry. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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
