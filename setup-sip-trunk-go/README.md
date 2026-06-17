# SIP Trunking Setup with Go and Gin

## What Does This Example Do?

Build a production-ready Go application with Gin that manages SIP trunk connections via the Telnyx API. This tutorial demonstrates how to create, list, and retrieve SIP connections using the Telnyx Go SDK, configure credential-based authentication, and handle errors gracefully in a REST API. By the end, you'll have a fully functional SIP trunking management system ready for integration with your PBX or SBC.

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
- A publicly accessible IP address or domain for your SIP endpoint (required for inbound call routing).
- Basic familiarity with REST APIs and Go.
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/setup-sip-trunk-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/setup-sip-trunk-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` with Gin routes for managing SIP connections. The application will support creating, listing, and retrieving SIP trunk configurations:

```go
package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2"
)

var client *telnyx.Client

func init() {
	config := LoadConfig()
	if config.TelnyxAPIKey == "" {
		fmt.Fprintf(os.Stderr, "Error: TELNYX_API_KEY environment variable not set\n")
		os.Exit(1)
	}
	client = telnyx.NewClient(option.WithAPIKey(config.TelnyxAPIKey))
}

// CreateSIPConnectionRequest represents the request body for creating a SIP connection.
type CreateSIPConnectionRequest struct {
	Name              string `json:"name" binding:"required"`
	Username          string `json:"username" binding:"required"`
	Password          string `json:"password" binding:"required"`
	SIPEndpointIP     string `json:"sip_endpoint_ip" binding:"required"`
	SIPEndpointPort   int    `json:"sip_endpoint_port" binding:"required"`
	OutboundVoiceProfile string `json:"outbound_voice_profile_id"`
}

// SIPConnectionResponse represents a serialized SIP connection for JSON responses.
type SIPConnectionResponse struct {
	ID                   string `json:"id"`
	Name                 string `json:"name"`
	Username             string `json:"username"`
	SIPEndpointIP        string `json:"sip_endpoint_ip"`
	SIPEndpointPort      int    `json:"sip_endpoint_port"`
	OutboundVoiceProfile string `json:"outbound_voice_profile_id"`
	CreatedAt            string `json:"created_at"`
}

// createSIPConnection handles POST /sip-connections to create a new SIP trunk.
func createSIPConnection(c *gin.Context) {
	var req CreateSIPConnectionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate required fields
	if req.SIPEndpointPort < 1 || req.SIPEndpointPort > 65535 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "SIP endpoint port must be between 1 and 65535"})
		return
	}

	// Create SIP connection via Telnyx API
	params := &telnyx.SIPConnectionCreateParams{
		ConnectionName: req.Name,
		Credentials: &telnyx.SIPConnectionCredentials{
			Username: req.Username,
			Password: req.Password,
		},
		SIPEndpoints: []*telnyx.SIPEndpoint{
			{
				Address: req.SIPEndpointIP,
				Port:    req.SIPEndpointPort,
				Enabled: true,
			},
		},
	}

	if req.OutboundVoiceProfile != "" {
		params.OutboundVoiceProfileID = req.OutboundVoiceProfile
	}

	response, err := client.SIPConnections.Create(params)
	if err != nil {
		handleTelnyxError(c, err)
		return
	}

	// Extract serializable data from SDK response
	result := SIPConnectionResponse{
		ID:            response.Data.ID,
		Name:          response.Data.ConnectionName,
		Username:      response.Data.Credentials.Username,
		SIPEndpointIP: response.Data.SIPEndpoints[0].Address,
		SIPEndpointPort: response.Data.SIPEndpoints[0].Port,
		CreatedAt:     response.Data.CreatedAt.String(),
	}

	if response.Data.OutboundVoiceProfileID != "" {
		result.OutboundVoiceProfile = response.Data.OutboundVoiceProfileID
	}

	c.JSON(http.StatusCreated, result)
}

// listSIPConnections handles GET /sip-connections to list all SIP trunks.
func listSIPConnections(c *gin.Context) {
	response, err := client.SIPConnections.List(&telnyx.SIPConnectionListParams{})
	if err != nil {
		handleTelnyxError(c, err)
		return
	}

	// Extract serializable data from SDK response list
	var connections []SIPConnectionResponse
	for _, conn := range response.Data {
		sip := SIPConnectionResponse{
			ID:       conn.ID,
			Name:     conn.ConnectionName,
			Username: conn.Credentials.Username,
			CreatedAt: conn.CreatedAt.String(),
		}

		if len(conn.SIPEndpoints) > 0 {
			sip.SIPEndpointIP = conn.SIPEndpoints[0].Address
			sip.SIPEndpointPort = conn.SIPEndpoints[0].Port
		}

		if conn.OutboundVoiceProfileID != "" {
			sip.OutboundVoiceProfile = conn.OutboundVoiceProfileID
		}

		connections = append(connections, sip)
	}

	c.JSON(http.StatusOK, connections)
}

// getSIPConnection handles GET /sip-connections/:id to retrieve a specific SIP trunk.
func getSIPConnection(c *gin.Context) {
	connectionID := c.Param("id")
	if connectionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Connection ID required"})
		return
	}

	response, err := client.SIPConnections.Retrieve(connectionID)
	if err != nil {
		handleTelnyxError(c, err)
		return
	}

	// Extract serializable data from SDK response
	result := SIPConnectionResponse{
		ID:       response.Data.ID,
		Name:     response.Data.ConnectionName,
		Username: response.Data.Credentials.Username,
		CreatedAt: response.Data.CreatedAt.String(),
	}

	if len(response.Data.SIPEndpoints) > 0 {
		result.SIPEndpointIP = response.Data.SIPEndpoints[0].Address
		result.SIPEndpointPort = response.Data.SIPEndpoints[0].Port
	}

	if response.Data.OutboundVoiceProfileID != "" {
		result.OutboundVoiceProfile = response.Data.OutboundVoiceProfileID
	}

	c.JSON(http.StatusOK, result)
}

// handleTelnyxError maps Telnyx SDK errors to HTTP status codes.
func handleTelnyxError(c *gin.Context, err error) {
	switch e := err.(type) {
	case *telnyx.AuthenticationError:
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
	case *telnyx.RateLimitError:
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
	case *telnyx.APIStatusError:
		c.JSON(e.StatusCode, gin.H{"error": e.Error(), "status_code": e.StatusCode})
	case *telnyx.APIConnectionError:
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
	}
}

func main() {
	router := gin.Default()

	// SIP connection routes
	router.POST("/sip-connections", createSIPConnection)
	router.GET("/sip-connections", listSIPConnections)
	router.GET("/sip-connections/:id", getSIPConnection)

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	fmt.Println("Starting SIP Trunking API on :8080")
	if err := router.Run(":8080"); err != nil {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}
```

## Complete Code

See [`main.go`](./main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Go server. |
| SIP Endpoint Port Out of Range | You receive a 400 error stating "SIP endpoint port must be between 1 and 65535". | Ensure the `sip_endpoint_port` in your request is a valid port number. Standard SIP ports are 5060 (UDP) and 5061 (TLS). Update your curl request to use a valid port number. |
| Connection ID Not Found | The endpoint returns a 404 error or "Connection not found" when retrieving a specific SIP connection. | Verify the connection ID is correct by first listing all connections with `GET /sip-connections`. Copy the exact ID from the response and use it in your retrieve request. Connection IDs are case-sensitive. |
| Missing Required Fields | The endpoint returns a 400 error with "missing required field" message. | Ensure your POST request includes all required fields: `name`, `username`, `password`, `sip_endpoint_ip`, and `sip_endpoint_port`. Verify the JSON is properly formatted and all string values are quoted. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Check your internet connection and verify that the Telnyx API is accessible. Ensure your firewall or proxy is not blocking outbound HTTPS connections to `api.telnyx.com`. Retry the request after a few seconds. |

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

- [Configure SIP Authentication Methods](/tutorials/sip/go/sip-authentication).
- [Set Up Inbound SIP Call Routing](/tutorials/sip/go/inbound-sip-routing).
- [Implement Failover Routing for High Availability](/tutorials/sip/go/failover-routing).
