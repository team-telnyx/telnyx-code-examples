# CNAM Lookup with Go and Gin

## What Does This Example Do?

Build a production-ready Gin endpoint that performs CNAM (Caller Name) lookups using the Telnyx Go SDK. This tutorial demonstrates how to identify incoming caller information, implement proper error handling for telecom APIs, and return structured JSON responses. CNAM lookups are essential for call screening, fraud detection, and customer experience enhancement in voice applications.

## Who Is This For?

- **Go developers** building sip features with Gin.
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
- The Telnyx Go SDK and Gin framework installed.
- A phone number in E.164 format to perform lookups against.
- Basic familiarity with Go and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-cnam-lookup-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `cnam.go` file to handle CNAM lookup logic:

```go
package main

import (
	"context"
	"fmt"

	"github.com/team-telnyx/telnyx-go/v4"
)

// CNAMResult represents the response data from a CNAM lookup.
type CNAMResult struct {
	PhoneNumber string `json:"phone_number"`
	CallerName  string `json:"caller_name"`
	CarrierName string `json:"carrier_name"`
	Status      string `json:"status"`
}

// PerformCNAMLookup queries the Telnyx CNAM API for caller information.
// Phone number must be in E.164 format (e.g., +15551234567).
func PerformCNAMLookup(client *telnyx.Client, phoneNumber string) (*CNAMResult, error) {
	// Validate E.164 format to prevent API errors.
	if len(phoneNumber) < 10 || phoneNumber[0] != '+' {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Call the CNAM lookup endpoint.
	// The Telnyx Go SDK exposes this via the CnamLookups resource.
	response, err := client.CnamLookups.Retrieve(
		context.Background(),
		phoneNumber,
	)
	if err != nil {
		return nil, err
	}

	// Extract serializable data from the SDK response.
	result := &CNAMResult{
		PhoneNumber: phoneNumber,
		Status:      "success",
	}

	if response.Data != nil {
		if response.Data.CallerName != nil {
			result.CallerName = *response.Data.CallerName
		}
		if response.Data.CarrierName != nil {
			result.CarrierName = *response.Data.CarrierName
		}
	}

	return result, nil
}
```

Create the main `main.go` file with Gin route handlers and error handling:

```go
package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4"
)

func main() {
	// Load configuration from environment.
	config, err := LoadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	// Initialize Telnyx client.
	client := NewTelnyxClient(config.APIKey)

	// Create Gin router.
	router := gin.Default()

	// Health check endpoint.
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	// CNAM lookup endpoint.
	router.POST("/cnam/lookup", func(c *gin.Context) {
		var req struct {
			PhoneNumber string `json:"phone_number" binding:"required"`
		}

		// Parse and validate request body.
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Missing required field: 'phone_number'",
			})
			return
		}

		// Perform CNAM lookup with error handling.
		result, err := PerformCNAMLookup(client, req.PhoneNumber)

		// Handle Telnyx-specific errors.
		if err != nil {
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
				// Handle validation errors and other issues.
				c.JSON(http.StatusBadRequest, gin.H{
					"error": err.Error(),
				})
				return
			}
		}

		// Return successful CNAM lookup result.
		c.JSON(http.StatusOK, result)
	})

	// Start the server.
	addr := fmt.Sprintf(":%s", config.Port)
	log.Printf("Starting CNAM lookup server on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-cnam-lookup-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or newlines. If the key was regenerated recently, update your environment file and restart the Go server. |
| Invalid Phone Number Format | You receive a 400 error stating "phone number must be in E.164 format" or a Telnyx API error about invalid format. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl request to use properly formatted numbers. |
| Environment Variable Not Set | The application fails to start with error "TELNYX_API_KEY environment variable not set". | Confirm your `.env` file exists in the same directory as `main.go` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `godotenv.Load()` call must execute before `os.Getenv()` is called. Verify the import order in your code. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | CNAM lookups are rate-limited by Telnyx. Implement exponential backoff in your client code and cache results when possible. Space out requests to avoid hitting the limit. Check your [Telnyx Portal](https://portal.telnyx.com) for current rate limit details. |
| No CNAM Data Available | The lookup succeeds but `caller_name` and `carrier_name` fields are empty strings. | CNAM data is not available for all phone numbers, especially unlisted or international numbers. This is a normal condition—the API returns success but with empty fields. Your application should handle empty strings gracefully in the UI. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Go version do I need?**

Go 1.22 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [SIP Configuration Guides](https://developers.telnyx.com/docs/voice/sip-trunking/configuration-guides)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)

## Related Examples

- [Set Up SIP Trunking with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/go/sip-trunking-setup).
- [Configure SIP Authentication](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/go/sip-authentication).
- [Route Inbound SIP Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/go/inbound-sip-routing).
