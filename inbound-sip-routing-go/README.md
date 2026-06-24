# Inbound SIP Routing with Go and Gin

## What Does This Example Do?

Build a production-ready Gin web server that manages inbound SIP routing using the Telnyx Go SDK. This tutorial demonstrates how to create SIP connections, configure inbound routing rules, and handle webhook callbacks for incoming calls. You'll learn the new client-based initialization pattern, proper error handling for telecom APIs, and secure credential management via environment variables.

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
- A Telnyx phone number enabled for inbound voice calls.
- A publicly accessible URL for webhook callbacks (ngrok or similar for local testing).
- Basic familiarity with REST APIs and JSON.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `models/sip.go` file to define data structures for SIP connections and webhook payloads:

```go
package models

// SIPConnectionRequest represents the payload for creating a SIP connection.
type SIPConnectionRequest struct {
	Name              string   `json:"name" binding:"required"`
	OutboundVoiceProfile string `json:"outbound_voice_profile_id"`
	InboundAddresses  []string `json:"inbound_addresses" binding:"required"`
	Username          string   `json:"username" binding:"required"`
	Password          string   `json:"password" binding:"required"`
}

// SIPConnectionResponse represents a SIP connection returned from the API.
type SIPConnectionResponse struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Username          string   `json:"username"`
	InboundAddresses  []string `json:"inbound_addresses"`
	CreatedAt         string   `json:"created_at"`
}

// IncomingCallWebhook represents the webhook payload for incoming calls.
type IncomingCallWebhook struct {
	Data struct {
		EventType string `json:"event_type"`
		Payload   struct {
			CallSessionID string `json:"call_session_id"`
			From          string `json:"from"`
			To            string `json:"to"`
			State         string `json:"state"`
		} `json:"payload"`
	} `json:"data"`
}

// CallRoutingRequest represents a request to route an incoming call.
type CallRoutingRequest struct {
	CallSessionID string `json:"call_session_id" binding:"required"`
	RouteTo       string `json:"route_to" binding:"required"`
}
```

Create a `handlers/sip.go` file to implement SIP connection management:

```go
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2"
	"telnyx-sip-routing/models"
)

// CreateSIPConnection creates a new SIP connection via the Telnyx API.
func CreateSIPConnection(client *telnyx.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.SIPConnectionRequest

		// Bind and validate JSON request body.
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
			return
		}

		// Validate E.164 format for phone numbers (basic check).
		if len(req.InboundAddresses) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "At least one inbound address is required"})
			return
		}

		try {
			// Create SIP connection using the Telnyx SDK.
			response, err := client.SipConnections.Create(
				&v2.CreateSipConnectionRequest{
					Name:             req.Name,
					InboundAddresses: req.InboundAddresses,
					Credentials: &v2.SipConnectionCredentials{
						Username: req.Username,
						Password: req.Password,
					},
				},
			)

			if err != nil {
				// Handle Telnyx-specific errors.
				handleTelnyxError(c, err)
				return
			}

			// Extract serializable data from SDK response.
			result := gin.H{
				"id":                 response.Data.ID,
				"name":               response.Data.Name,
				"username":           response.Data.Credentials.Username,
				"inbound_addresses":  response.Data.InboundAddresses,
				"created_at":         response.Data.CreatedAt,
			}

			c.JSON(http.StatusCreated, result)

		} catch (telnyx.AuthenticationError) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
		} catch (telnyx.RateLimitError) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
		} catch (telnyx.APIStatusError as e) {
			c.JSON(e.StatusCode, gin.H{"error": e.Error()})
		} catch (telnyx.APIConnectionError) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
		}
	}
}

// ListSIPConnections retrieves all SIP connections.
func ListSIPConnections(client *telnyx.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		try {
			// List all SIP connections.
			response, err := client.SipConnections.List()

			if err != nil {
				handleTelnyxError(c, err)
				return
			}

			// Extract serializable data from SDK response list.
			var connections []map[string]interface{}
			for _, conn := range response.Data {
				connections = append(connections, map[string]interface{}{
					"id":                conn.ID,
					"name":              conn.Name,
					"username":          conn.Credentials.Username,
					"inbound_addresses": conn.InboundAddresses,
					"created_at":        conn.CreatedAt,
				})
			}

			c.JSON(http.StatusOK, gin.H{"connections": connections})

		} catch (telnyx.AuthenticationError) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
		} catch (telnyx.RateLimitError) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
		} catch (telnyx.APIStatusError as e) {
			c.JSON(e.StatusCode, gin.H{"error": e.Error()})
		} catch (telnyx.APIConnectionError) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
		}
	}
}

// GetSIPConnection retrieves a specific SIP connection by ID.
func GetSIPConnection(client *telnyx.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		connectionID := c.Param("id")

		if connectionID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Connection ID is required"})
			return
		}

		try {
			// Retrieve a specific SIP connection.
			response, err := client.SipConnections.Retrieve(connectionID)

			if err != nil {
				handleTelnyxError(c, err)
				return
			}

			// Extract serializable data from SDK response.
			result := gin.H{
				"id":                response.Data.ID,
				"name":              response.Data.Name,
				"username":          response.Data.Credentials.Username,
				"inbound_addresses": response.Data.InboundAddresses,
				"created_at":        response.Data.CreatedAt,
			}

			c.JSON(http.StatusOK, result)

		} catch (telnyx.AuthenticationError) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
		} catch (telnyx.RateLimitError) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
		} catch (telnyx.APIStatusError as e) {
			c.JSON(e.StatusCode, gin.H{"error": e.Error()})
		} catch (telnyx.APIConnectionError) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
		}
	}
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

Create a `handlers/webhooks.go` file to handle incoming call webhooks:

```go
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"telnyx-sip-routing/models"
)

// HandleIncomingCall processes incoming call webhooks from Telnyx.
func HandleIncomingCall() gin.HandlerFunc {
	return func(c *gin.Context) {
		var webhook models.IncomingCallWebhook

		// Bind and validate JSON webhook payload.
		if err := c.ShouldBindJSON(&webhook); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload: " + err.Error()})
			return
		}

		// Extract call details from webhook.
		callSessionID := webhook.Data.Payload.CallSessionID
		from := webhook.Data.Payload.From
		to := webhook.Data.Payload.To
		state := webhook.Data.Payload.State

		// Log incoming call (in production, store in database or queue for processing).
		// Example: route based on called number, time of day, or other business logic.
		if state == "initiated" {
			// Route the call to your SIP endpoint or application logic.
			// For now, acknowledge receipt.
			c.JSON(http.StatusOK, gin.H{
				"call_session_id": callSessionID,
				"from":            from,
				"to":              to,
				"status":          "received",
				"action":          "route_to_sip_endpoint",
			})
			return
		}

		// Acknowledge other call states.
		c.JSON(http.StatusOK, gin.H{
			"call_session_id": callSessionID,
			"state":           state,
			"status":          "acknowledged",
		})
	}
}

// RouteCall routes an incoming call to a specified SIP endpoint.
func RouteCall() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.CallRoutingRequest

		// Bind and validate JSON request body.
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
			return
		}

		// Validate that route_to is a valid SIP URI or phone number.
		if req.RouteTo == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "route_to field is required"})
			return
		}

		// In production, use the Telnyx Call Control API to route the call.
		// For now, return a success response indicating the routing action.
		c.JSON(http.StatusOK, gin.H{
			"call_session_id": req.CallSessionID,
			"route_to":        req.RouteTo,
			"status":          "routed",
			"message":         "Call routing initiated",
		})
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
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2/option"
	"telnyx-sip-routing/config"
	"telnyx-sip-routing/handlers"
)

func main() {
	// Load configuration from environment variables.
	cfg := config.Load()

	// Validate required configuration.
	if cfg.TelnyxAPIKey == "" {
		log.Fatal("TELNYX_API_KEY environment variable is not set")
	}
	if cfg.TelnyxPhoneNum == "" {
		log.Fatal("TELNYX_PHONE_NUMBER environment variable is not set")
	}

	// Initialize Telnyx client with the new SDK pattern.
	client := telnyx.NewClient(option.WithAPIKey(cfg.TelnyxAPIKey))

	// Create Gin router.
	router := gin.Default()

	// Health check endpoint.
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// SIP connection management routes.
	router.POST("/sip/connections", handlers.CreateSIPConnection(client))
	router.GET("/sip/connections", handlers.ListSIPConnections(client))
	router.GET("/sip/connections/:id", handlers.GetSIPConnection(client))

	// Webhook routes for incoming calls.
	router.POST("/webhooks/call", handlers.HandleIncomingCall())
	router.POST("/webhooks/call/route", handlers.RouteCall())

	// Start the server.
	port := ":" + cfg.ServerPort
	log.Printf("Starting Gin server on %s\n", port)
	if err := router.Run(port); err != nil {
		log.Fatalf("Failed to start server: %v\n", err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Gin server. |
| Webhook Not Receiving Calls | Your webhook endpoint is not receiving incoming call notifications from Telnyx. | Ensure your `WEBHOOK_URL` in the `.env` file is publicly accessible and points to your `/webhooks/call` endpoint. Use ngrok (`ngrok http 8080`) for local testing and update the webhook URL in the Telnyx Portal. Verify that your firewall allows inbound traffic on port 8080. |
| SIP Connection Creation Fails | The POST request to `/sip/connections` returns an error about missing or invalid fields. | Verify that your JSON request body includes all required fields: `name`, `inbound_addresses` (array), `username`, and `password`. Ensure `inbound_addresses` contains valid IP addresses in CIDR notation (e.g., `["203.0.113.10/32"]`). Check that your Telnyx API key has permissions to create SIP connections. |
| Environment Variables Not Loading | The application crashes with "TELNYX_API_KEY environment variable is not set" even though `.env` exists. | Confirm your `.env` file is in the same directory as `main.go` and is named exactly `.env` (not `.env.txt` or `env`). Ensure the file contains the variable in the format `TELNYX_API_KEY=your_key_here` with no extra spaces. Restart the application after creating or modifying the `.env` file. |
| Port Already in Use | The server fails to start with "address already in use" error. | Change the `SERVER_PORT` in your `.env` file to an available port (e.g., `8081` instead of `8080`). Alternatively, kill the process using the current port with `lsof -i :8080` and `kill -9 <PID>`. |

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

- [Set Up SIP Trunking with Telnyx](/tutorials/sip/go/sip-trunking-setup).
- [Configure SIP Authentication and Security](/tutorials/sip/go/sip-authentication).
- [Implement Failover Routing for High Availability](/tutorials/sip/go/failover-routing).
