# Configure SIP Registration with Go and Gin

## What Does This Example Do?

Build a production-ready Gin API that manages SIP connections for PBX registration using the Telnyx Go SDK. This tutorial demonstrates credential-based authentication setup, secure credential management, and proper error handling for telecom infrastructure APIs.

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

- Go 1.18 or higher
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com)
- A Telnyx phone number (for testing inbound/outbound routing)
- ngrok or a public server (for webhook testing, if extending to inbound calls)

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-registration-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-registration-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` and initialize the Telnyx client using the new pattern. Define handlers for creating and listing SIP connections with credential authentication:

```go
package main

import (
	"context"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/option"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		panic("Error loading .env file")
	}

	// Initialize client using new pattern — NOT global API key assignment
	client := telnyx.NewClient(option.WithAPIKey(os.Getenv("TELNYX_API_KEY")))

	r := gin.Default()

	// Create SIP connection with credential authentication for PBX registration
	r.POST("/sip-connections", func(c *gin.Context) {
		var req struct {
			Name     string `json:"name" binding:"required"`
			Username string `json:"username" binding:"required"`
			Password string `json:"password" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
			return
		}

		// Create connection with credentials for SIP REGISTER authentication
		resp, err := client.SIPConnections.Create(c.Request.Context(), telnyx.SIPConnectionCreateParams{
			Name: req.Name,
			SIPAuthentication: &telnyx.SIPAuthentication{
				Username: req.Username,
				Password: req.Password,
			},
			TransportProtocol: "TLS", // Enable encrypted signaling
		})

		if err != nil {
			handleTelnyxError(c, err)
			return
		}

		// Unpack SDK response to JSON-serializable map — SDK objects are NOT directly serializable
		c.JSON(http.StatusCreated, gin.H{
			"id":     resp.Data.ID,
			"name":   resp.Data.Name,
			"status": resp.Data.Status,
			"sip_authentication": gin.H{
				"username": resp.Data.SIPAuthentication.Username,
				"realm":    resp.Data.SIPAuthentication.Realm,
			},
			"transport_protocol": resp.Data.TransportProtocol,
		})
	})

	// List all SIP connections
	r.GET("/sip-connections", func(c *gin.Context) {
		resp, err := client.SIPConnections.List(c.Request.Context(), telnyx.SIPConnectionListParams{})
		if err != nil {
			handleTelnyxError(c, err)
			return
		}

		// Serialize list data — unpack each SDK object to plain map
		connections := make([]gin.H, 0, len(resp.Data))
		for _, conn := range resp.Data {
			connections = append(connections, gin.H{
				"id":     conn.ID,
				"name":   conn.Name,
				"status": conn.Status,
			})
		}

		c.JSON(http.StatusOK, gin.H{"data": connections})
	})

	r.Run(":8080")
}

// handleTelnyxError routes SDK errors to appropriate HTTP responses
func handleTelnyxError(c *gin.Context, err error) {
	// Type assertions for specific Telnyx error types (flat namespace)
	if _, ok := err.(*telnyx.AuthenticationError); ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
		return
	}
	if _, ok := err.(*telnyx.RateLimitError); ok {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
		return
	}
	if apiErr, ok := err.(*telnyx.APIStatusError); ok {
		c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error(), "status_code": apiErr.StatusCode})
		return
	}
	if _, ok := err.(*telnyx.APIConnectionError); ok {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
		return
	}

	// Fallback for generic Telnyx errors or unexpected errors
	c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error: " + err.Error()})
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-go/main.go) for the full implementation.

## Troubleshooting

### Issue 1: Authentication Error (401)

**Problem:** The API returns `{"error": "Invalid API key"}` with HTTP 401 when creating a connection.

**Solution:** Verify your `TELNYX_API_KEY` environment variable is set correctly. Run `echo $TELNYX_API_KEY` to confirm it's loaded. Ensure the `.env` file is in the same directory as your `main.go` and contains no extra quotes or spaces around the key. If using `godotenv`, ensure the file is named exactly `.env` and not `.env.txt`.

### Issue 2: SIP Registration Failures

**Problem:** Your PBX cannot register to `sip.telnyx.com` using the credentials created via the API.

**Solution:** Verify the username and password in your PBX configuration exactly match the values sent to the API. Check that your PBX is configured to use TLS transport (port 5061) if you specified `"transport_protocol": "TLS"`. For credential authentication, ensure your PBX is set to register, not use IP authentication. The realm should be `sip.telnyx.com`.

### Issue 3: Empty Response or Nil Pointer Dereference

**Problem:** The application panics with a nil pointer dereference or returns empty data after creating a connection.

**Solution:** Ensure you are unpacking the SDK response correctly. Never access `resp.Data` fields without checking if `resp` is nil. The SDK returns pointers to structs—always verify `resp != nil` before accessing `resp.Data`. In the code above, we check for errors first, which handles nil response cases from failed requests.

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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

- [Make Outbound SIP Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/go/outbound-sip-call)
- [Configure Inbound SIP Routing](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/go/inbound-sip-routing)
- [Set Up Failover Routing](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/go/failover-routing)
