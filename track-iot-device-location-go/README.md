# Device Location with Go and Gin

## What Does This Example Do?

Build a production-ready Gin web service that tracks IoT device locations using Telnyx SIM cards. This tutorial demonstrates how to query SIM card network attachment data, correlate device identifiers with location information, and expose location endpoints via REST API. You'll learn the new Go SDK client initialization pattern, proper error handling for telecom APIs, and secure credential management via environment variables.

## Who Is This For?

- **Go developers** building iot features with Gin.
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
- Active SIM cards provisioned in your Telnyx account.
- A basic understanding of REST APIs and JSON.
- `go get` and a terminal for running commands.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/track-iot-device-location-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `device.go` file to define data structures and helper functions for device location tracking:

```go
package main

import (
	"fmt"

	"github.com/team-telnyx/telnyx-go/v4/v2"
)

// DeviceLocation represents a device's location information derived from SIM card data.
type DeviceLocation struct {
	SimCardID       string `json:"sim_card_id"`
	ICCID           string `json:"iccid"`
	Status          string `json:"status"`
	NetworkOperator string `json:"network_operator"`
	IsAttached      bool   `json:"is_attached"`
	LastUpdated     string `json:"last_updated"`
}

// GetDeviceLocation retrieves location information for a specific SIM card.
// In production, this would correlate SIM data with GPS or cellular triangulation data.
func GetDeviceLocation(client *telnyx.Client, simCardID string) (*DeviceLocation, error) {
	// Retrieve SIM card details from Telnyx API.
	response, err := client.SimCards.Retrieve(simCardID)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve SIM card: %w", err)
	}

	simCard := response.Data

	// Determine if device is attached to network.
	isAttached := simCard.Status == "active"

	// Extract network operator from SIM card data.
	networkOperator := "unknown"
	if simCard.NetworkOperator != nil {
		networkOperator = *simCard.NetworkOperator
	}

	location := &DeviceLocation{
		SimCardID:       simCard.ID,
		ICCID:           simCard.ICCID,
		Status:          simCard.Status,
		NetworkOperator: networkOperator,
		IsAttached:      isAttached,
		LastUpdated:     simCard.UpdatedAt.String(),
	}

	return location, nil
}

// ListDeviceLocations retrieves location information for all SIM cards in the account.
func ListDeviceLocations(client *telnyx.Client) ([]DeviceLocation, error) {
	// Retrieve paginated list of SIM cards.
	response, err := client.SimCards.List()
	if err != nil {
		return nil, fmt.Errorf("failed to list SIM cards: %w", err)
	}

	var locations []DeviceLocation

	for _, simCard := range response.Data {
		isAttached := simCard.Status == "active"
		networkOperator := "unknown"
		if simCard.NetworkOperator != nil {
			networkOperator = *simCard.NetworkOperator
		}

		location := DeviceLocation{
			SimCardID:       simCard.ID,
			ICCID:           simCard.ICCID,
			Status:          simCard.Status,
			NetworkOperator: networkOperator,
			IsAttached:      isAttached,
			LastUpdated:     simCard.UpdatedAt.String(),
		}

		locations = append(locations, location)
	}

	return locations, nil
}
```

Create a `handlers.go` file to define HTTP route handlers with comprehensive error handling:

```go
package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4/v2"
)

// DeviceLocationHandler holds dependencies for HTTP handlers.
type DeviceLocationHandler struct {
	client *telnyx.Client
}

// NewDeviceLocationHandler creates a new handler with a Telnyx client.
func NewDeviceLocationHandler(client *telnyx.Client) *DeviceLocationHandler {
	return &DeviceLocationHandler{
		client: client,
	}
}

// GetDeviceLocation handles GET /devices/:sim_card_id requests.
func (h *DeviceLocationHandler) GetDeviceLocation(c *gin.Context) {
	simCardID := c.Param("sim_card_id")

	if simCardID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sim_card_id parameter required"})
		return
	}

	location, err := GetDeviceLocation(h.client, simCardID)

	// Handle Telnyx SDK errors with appropriate HTTP status codes.
	if err != nil {
		switch err.(type) {
		case *telnyx.AuthenticationError:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
		case *telnyx.RateLimitError:
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
		case *telnyx.APIStatusError:
			apiErr := err.(*telnyx.APIStatusError)
			c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error()})
		case *telnyx.APIConnectionError:
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, location)
}

// ListDeviceLocations handles GET /devices requests.
func (h *DeviceLocationHandler) ListDeviceLocations(c *gin.Context) {
	locations, err := ListDeviceLocations(h.client)

	// Handle Telnyx SDK errors with appropriate HTTP status codes.
	if err != nil {
		switch err.(type) {
		case *telnyx.AuthenticationError:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
		case *telnyx.RateLimitError:
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
		case *telnyx.APIStatusError:
			apiErr := err.(*telnyx.APIStatusError)
			c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error()})
		case *telnyx.APIConnectionError:
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"devices": locations})
}

// HealthCheck handles GET /health requests.
func (h *DeviceLocationHandler) HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "healthy"})
}
```

Create the main `main.go` file to set up the Gin router and start the server:

```go
package main

import (
	"log"

	"github.com/gin-gonic/gin"
)

func main() {
	// Load configuration from environment variables.
	cfg := LoadConfig()

	// Initialize Telnyx client with the new SDK pattern.
	client := NewTelnyxClient(cfg)

	// Create Gin router.
	router := gin.Default()

	// Initialize handler with client dependency.
	handler := NewDeviceLocationHandler(client)

	// Define routes.
	router.GET("/health", handler.HealthCheck)
	router.GET("/devices", handler.ListDeviceLocations)
	router.GET("/devices/:sim_card_id", handler.GetDeviceLocation)

	// Start server on port 8080.
	log.Println("Starting device location service on :8080")
	if err := router.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/track-iot-device-location-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or newlines. If the key was regenerated recently, update your environment file and restart the Gin server. Run `echo $TELNYX_API_KEY` to confirm the variable is loaded correctly. |
| SIM Card Not Found (500) | The endpoint returns `{"error": "failed to retrieve SIM card: ..."}` when querying a specific device. | Verify the `sim_card_id` parameter matches an active SIM card in your Telnyx account. Check the [Telnyx Portal](https://portal.telnyx.com) under IoT → SIM Cards to confirm the SIM card ID format and existence. Use the `/devices` endpoint first to list all available SIM cards and their IDs. |
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API enforces rate limits on requests. Implement exponential backoff in your client code and cache location data when possible. Space out requests to the `/devices` endpoint and avoid polling more frequently than every 30 seconds. Consider using webhooks (sim_card.status.changed) for real-time updates instead of polling. |
| Empty Device List | The `/devices` endpoint returns `{"devices": []}` even though SIM cards exist in the account. | Ensure your API key has permissions to read SIM card data. Verify SIM cards are provisioned in your account by checking the [Telnyx Portal](https://portal.telnyx.com). If SIM cards were recently added, they may take a few minutes to appear in API responses. Check that the SIM cards are not in a "pending" state. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Go version do I need?**

Go 1.22 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [SIM Card API Reference](https://developers.telnyx.com/api-reference/sim-cards/get-all-sim-cards)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)

## Related Examples

- [Monitor SIM Card Data Usage](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/go/data-usage-monitoring).
- [Activate SIM Cards Programmatically](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/go/sim-activation).
- [Handle SIM Status Change Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/go/sim-status-webhook).
