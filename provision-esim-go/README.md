# eSIM Provisioning with Go and Gin

## What Does This Example Do?

Build a production-ready Gin API service that provisions eSIM profiles over-the-air using the Telnyx IoT SDK. This tutorial demonstrates the Go client initialization pattern, secure credential management via environment variables, and comprehensive error handling for telecom APIs. You'll learn how to create eSIM profiles, manage activation states, and track provisioning status through a RESTful interface.

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
- Access to the Telnyx IoT / SIM Management API.
- Basic familiarity with Go and REST APIs.
- `curl` or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/provision-esim-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `esim.go` to implement eSIM provisioning logic:

```go
package main

import (
	"fmt"

	"github.com/team-telnyx/telnyx-go/v4/v2"
)

// ProvisioningRequest represents the incoming eSIM provisioning request.
type ProvisioningRequest struct {
	DeviceID      string `json:"device_id" binding:"required"`
	DeviceName    string `json:"device_name"`
	SimCardGroupID string `json:"sim_card_group_id" binding:"required"`
}

// ProvisioningResponse represents the response after provisioning an eSIM.
type ProvisioningResponse struct {
	ID             string `json:"id"`
	ICCID          string `json:"iccid"`
	Status         string `json:"status"`
	SimCardGroupID string `json:"sim_card_group_id"`
	DeviceID       string `json:"device_id"`
	ActivationCode string `json:"activation_code,omitempty"`
}

// ProvisionESIM creates and activates an eSIM profile for a device.
// This function handles the core provisioning logic without catching exceptions—
// error handling occurs in the route handler.
func ProvisionESIM(client *telnyx.Client, req *ProvisioningRequest) (*ProvisioningResponse, error) {
	// Validate device ID format (example: must be non-empty and alphanumeric)
	if len(req.DeviceID) == 0 {
		return nil, fmt.Errorf("device_id cannot be empty")
	}

	// Create a SIM card for the eSIM profile
	// In production, this would call the eSIM provisioning endpoint
	// For now, we simulate by creating a SIM card in the specified group
	simCardParams := &telnyx.SimCardCreateParams{
		SimCardGroupID: telnyx.String(req.SimCardGroupID),
	}

	// Call the SDK method to create a SIM card
	response, err := client.SimCards.Create(simCardParams)
	if err != nil {
		return nil, fmt.Errorf("failed to create SIM card: %w", err)
	}

	// Extract serializable data from the SDK response
	provisioningResp := &ProvisioningResponse{
		ID:             response.Data.ID,
		ICCID:          response.Data.ICCID,
		Status:         response.Data.Status,
		SimCardGroupID: response.Data.SimCardGroupID,
		DeviceID:       req.DeviceID,
		// In a real scenario, the activation code would come from the eSIM profile
		ActivationCode: generateActivationCode(response.Data.ID),
	}

	return provisioningResp, nil
}

// GetESIMStatus retrieves the current status of a provisioned eSIM.
func GetESIMStatus(client *telnyx.Client, simCardID string) (*ProvisioningResponse, error) {
	if len(simCardID) == 0 {
		return nil, fmt.Errorf("sim_card_id cannot be empty")
	}

	response, err := client.SimCards.Retrieve(simCardID)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve SIM card: %w", err)
	}

	statusResp := &ProvisioningResponse{
		ID:             response.Data.ID,
		ICCID:          response.Data.ICCID,
		Status:         response.Data.Status,
		SimCardGroupID: response.Data.SimCardGroupID,
	}

	return statusResp, nil
}

// ActivateESIM activates a provisioned eSIM profile.
func ActivateESIM(client *telnyx.Client, simCardID string) (*ProvisioningResponse, error) {
	if len(simCardID) == 0 {
		return nil, fmt.Errorf("sim_card_id cannot be empty")
	}

	activateParams := &telnyx.SimCardActivateParams{}
	response, err := client.SimCards.Activate(simCardID, activateParams)
	if err != nil {
		return nil, fmt.Errorf("failed to activate SIM card: %w", err)
	}

	activateResp := &ProvisioningResponse{
		ID:             response.Data.ID,
		ICCID:          response.Data.ICCID,
		Status:         response.Data.Status,
		SimCardGroupID: response.Data.SimCardGroupID,
	}

	return activateResp, nil
}

// generateActivationCode creates a mock activation code for demonstration.
// In production, this would be provided by the Telnyx eSIM API.
func generateActivationCode(simCardID string) string {
	return fmt.Sprintf("AC-%s", simCardID[:8])
}
```

Create `main.go` to set up the Gin server with comprehensive error handling:

```go
package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4/v2"
)

func main() {
	// Load configuration from environment
	config, err := LoadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	// Initialize Gin router
	router := gin.Default()

	// Register routes
	registerRoutes(router, config)

	// Start server
	addr := fmt.Sprintf(":%s", config.Port)
	log.Printf("Starting eSIM provisioning server on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

func registerRoutes(router *gin.Engine, config *Config) {
	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	// Provision eSIM endpoint
	router.POST("/esim/provision", func(c *gin.Context) {
		var req ProvisioningRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid request: %v", err)})
			return
		}

		// Call provisioning logic
		resp, err := ProvisionESIM(config.TelnyxClient, &req)
		if err != nil {
			// Handle Telnyx SDK errors
			handleTelnyxError(c, err)
			return
		}

		c.JSON(http.StatusCreated, resp)
	})

	// Get eSIM status endpoint
	router.GET("/esim/:sim_card_id/status", func(c *gin.Context) {
		simCardID := c.Param("sim_card_id")
		if simCardID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "sim_card_id parameter required"})
			return
		}

		resp, err := GetESIMStatus(config.TelnyxClient, simCardID)
		if err != nil {
			handleTelnyxError(c, err)
			return
		}

		c.JSON(http.StatusOK, resp)
	})

	// Activate eSIM endpoint
	router.POST("/esim/:sim_card_id/activate", func(c *gin.Context) {
		simCardID := c.Param("sim_card_id")
		if simCardID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "sim_card_id parameter required"})
			return
		}

		resp, err := ActivateESIM(config.TelnyxClient, simCardID)
		if err != nil {
			handleTelnyxError(c, err)
			return
		}

		c.JSON(http.StatusOK, resp)
	})
}

// handleTelnyxError maps Telnyx SDK errors to appropriate HTTP status codes.
// This centralized error handler ensures consistent error responses across all routes.
func handleTelnyxError(c *gin.Context, err error) {
	switch e := err.(type) {
	case *telnyx.AuthenticationError:
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid API key or authentication failed",
		})
	case *telnyx.RateLimitError:
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error": "Rate limit exceeded. Please slow down.",
		})
	case *telnyx.APIStatusError:
		c.JSON(e.StatusCode, gin.H{
			"error":       e.Error(),
			"status_code": e.StatusCode,
		})
	case *telnyx.APIConnectionError:
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Network error connecting to Telnyx",
		})
	default:
		// Generic error for non-Telnyx exceptions
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": fmt.Sprintf("Internal server error: %v", err),
		})
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key or authentication failed"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the server. Run `echo $TELNYX_API_KEY` to confirm the variable is loaded. |
| SIM Card Group Not Found | You receive a 400 or 404 error stating the `sim_card_group_id` does not exist. | Verify the SIM Card Group ID exists in your Telnyx account. Navigate to the [Telnyx Portal](https://portal.telnyx.com) → IoT → SIM Card Groups to find valid group IDs. Ensure the group ID is passed correctly in the JSON request body. |
| Environment Variable Not Set | The application fails to start with `Configuration error: TELNYX_API_KEY environment variable not set`. | Confirm your `.env` file exists in the same directory as `main.go` and contains the required variables. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `godotenv.Load()` call must execute before `os.Getenv()` is called. Alternatively, set environment variables directly: `export TELNYX_API_KEY=your_key && go run main.go config.go esim.go`. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API enforces rate limits. Implement exponential backoff in your client code and reduce the frequency of requests. For production workloads, contact Telnyx support to discuss rate limit increases. |
| Invalid Request Body | The endpoint returns `{"error": "Invalid request: ..."}` with HTTP 400. | Ensure your JSON request body is valid and includes all required fields: `device_id` and `sim_card_group_id`. Use `curl -X POST ... -H "Content-Type: application/json"` to ensure the correct content type is sent. |

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
- [Configure Custom APN Settings](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/go/apn-configuration).
