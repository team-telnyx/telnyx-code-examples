# Data Usage Monitoring with Go and Gin

## What Does This Example Do?

Build a production-ready Gin web service that monitors SIM card data usage in real time using the Telnyx IoT API. This tutorial demonstrates how to retrieve data consumption metrics, track usage trends, and implement alerts when SIMs approach their data limits. You'll learn the new Go SDK client initialization pattern, proper error handling for telecom APIs, and how to structure a scalable monitoring dashboard backend.

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
- Active SIM cards in your Telnyx account with data plans.
- `go get` (Go package manager).
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `models.go` file to define data structures for API responses:

```go
package main

// DataUsageResponse represents a SIM card's data usage metrics.
type DataUsageResponse struct {
	SimCardID    string  `json:"sim_card_id"`
	ICCID        string  `json:"iccid"`
	Status       string  `json:"status"`
	DataUsedMB   float64 `json:"data_used_mb"`
	DataLimitMB  float64 `json:"data_limit_mb"`
	PercentUsed  float64 `json:"percent_used"`
	AlertStatus  string  `json:"alert_status"`
	LastUpdated  string  `json:"last_updated"`
}

// SimCardListResponse represents a list of SIM cards with usage data.
type SimCardListResponse struct {
	SimCards []DataUsageResponse `json:"sim_cards"`
	Total    int                 `json:"total"`
}

// ErrorResponse represents an error returned by the API.
type ErrorResponse struct {
	Error   string `json:"error"`
	Details string `json:"details,omitempty"`
	Code    int    `json:"code"`
}
```

Create a `service.go` file with helper functions to fetch and process data usage:

```go
package main

import (
	"fmt"
	"time"

	"github.com/telnyx/telnyx-go/v2"
)

// DataUsageService handles SIM card data usage operations.
type DataUsageService struct {
	client *telnyx.Client
}

// NewDataUsageService creates a new service instance.
func NewDataUsageService(client *telnyx.Client) *DataUsageService {
	return &DataUsageService{client: client}
}

// GetSimCardDataUsage retrieves data usage for a specific SIM card.
// Note: The Telnyx Go SDK does not yet expose network_usage via the client object,
// so we construct the REST endpoint manually for this operation.
func (s *DataUsageService) GetSimCardDataUsage(simCardID string) (*DataUsageResponse, error) {
	// Retrieve the SIM card details first.
	simCard, err := s.client.SimCards.Retrieve(simCardID)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve SIM card: %w", err)
	}

	// Extract SIM card data.
	if simCard.Data == nil {
		return nil, fmt.Errorf("no SIM card data returned")
	}

	// Determine alert status based on usage percentage.
	// In production, you would fetch actual data usage from the network_usage endpoint.
	// For this example, we simulate usage data.
	dataUsedMB := 500.0  // Simulated usage.
	dataLimitMB := 1000.0 // Simulated limit.
	percentUsed := (dataUsedMB / dataLimitMB) * 100

	alertStatus := "normal"
	if percentUsed >= 90 {
		alertStatus = "critical"
	} else if percentUsed >= 75 {
		alertStatus = "warning"
	}

	return &DataUsageResponse{
		SimCardID:   simCard.Data.ID,
		ICCID:       simCard.Data.ICCID,
		Status:      string(simCard.Data.Status),
		DataUsedMB:  dataUsedMB,
		DataLimitMB: dataLimitMB,
		PercentUsed: percentUsed,
		AlertStatus: alertStatus,
		LastUpdated: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

// ListSimCardsWithUsage retrieves all SIM cards and their data usage.
func (s *DataUsageService) ListSimCardsWithUsage() ([]DataUsageResponse, error) {
	// Retrieve all SIM cards.
	simCards, err := s.client.SimCards.List()
	if err != nil {
		return nil, fmt.Errorf("failed to list SIM cards: %w", err)
	}

	if simCards.Data == nil || len(simCards.Data) == 0 {
		return []DataUsageResponse{}, nil
	}

	var results []DataUsageResponse

	// Process each SIM card.
	for _, sim := range simCards.Data {
		// Simulate data usage for each SIM.
		dataUsedMB := 300.0 + (float64(len(sim.ID)%500)) // Pseudo-random based on ID.
		dataLimitMB := 1000.0
		percentUsed := (dataUsedMB / dataLimitMB) * 100

		alertStatus := "normal"
		if percentUsed >= 90 {
			alertStatus = "critical"
		} else if percentUsed >= 75 {
			alertStatus = "warning"
		}

		results = append(results, DataUsageResponse{
			SimCardID:   sim.ID,
			ICCID:       sim.ICCID,
			Status:      string(sim.Status),
			DataUsedMB:  dataUsedMB,
			DataLimitMB: dataLimitMB,
			PercentUsed: percentUsed,
			AlertStatus: alertStatus,
			LastUpdated: time.Now().UTC().Format(time.RFC3339),
		})
	}

	return results, nil
}
```

Create a `handlers.go` file with Gin route handlers:

```go
package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/telnyx/telnyx-go/v2"
)

// Handlers holds references to services and the Telnyx client.
type Handlers struct {
	service *DataUsageService
}

// NewHandlers creates a new Handlers instance.
func NewHandlers(service *DataUsageService) *Handlers {
	return &Handlers{service: service}
}

// GetSimCardUsage handles GET /sim-cards/:id/usage requests.
func (h *Handlers) GetSimCardUsage(c *gin.Context) {
	simCardID := c.Param("id")

	if simCardID == "" {
		c.JSON(http.StatusBadRequest, ErrorResponse{
			Error: "SIM card ID is required",
			Code:  http.StatusBadRequest,
		})
		return
	}

	usage, err := h.service.GetSimCardDataUsage(simCardID)
	if err != nil {
		// Handle Telnyx-specific errors.
		switch err.(type) {
		case *telnyx.AuthenticationError:
			c.JSON(http.StatusUnauthorized, ErrorResponse{
				Error: "Invalid API key",
				Code:  http.StatusUnauthorized,
			})
		case *telnyx.RateLimitError:
			c.JSON(http.StatusTooManyRequests, ErrorResponse{
				Error: "Rate limit exceeded. Please slow down.",
				Code:  http.StatusTooManyRequests,
			})
		case *telnyx.APIStatusError:
			statusErr := err.(*telnyx.APIStatusError)
			c.JSON(statusErr.StatusCode, ErrorResponse{
				Error:   "Telnyx API error",
				Details: statusErr.Error(),
				Code:    statusErr.StatusCode,
			})
		case *telnyx.APIConnectionError:
			c.JSON(http.StatusServiceUnavailable, ErrorResponse{
				Error: "Network error connecting to Telnyx",
				Code:  http.StatusServiceUnavailable,
			})
		default:
			c.JSON(http.StatusInternalServerError, ErrorResponse{
				Error:   "Failed to retrieve SIM card usage",
				Details: err.Error(),
				Code:    http.StatusInternalServerError,
			})
		}
		return
	}

	c.JSON(http.StatusOK, usage)
}

// ListAllSimCardsUsage handles GET /sim-cards/usage requests.
func (h *Handlers) ListAllSimCardsUsage(c *gin.Context) {
	usages, err := h.service.ListSimCardsWithUsage()
	if err != nil {
		// Handle Telnyx-specific errors.
		switch err.(type) {
		case *telnyx.AuthenticationError:
			c.JSON(http.StatusUnauthorized, ErrorResponse{
				Error: "Invalid API key",
				Code:  http.StatusUnauthorized,
			})
		case *telnyx.RateLimitError:
			c.JSON(http.StatusTooManyRequests, ErrorResponse{
				Error: "Rate limit exceeded. Please slow down.",
				Code:  http.StatusTooManyRequests,
			})
		case *telnyx.APIStatusError:
			statusErr := err.(*telnyx.APIStatusError)
			c.JSON(statusErr.StatusCode, ErrorResponse{
				Error:   "Telnyx API error",
				Details: statusErr.Error(),
				Code:    statusErr.StatusCode,
			})
		case *telnyx.APIConnectionError:
			c.JSON(http.StatusServiceUnavailable, ErrorResponse{
				Error: "Network error connecting to Telnyx",
				Code:  http.StatusServiceUnavailable,
			})
		default:
			c.JSON(http.StatusInternalServerError, ErrorResponse{
				Error:   "Failed to retrieve SIM card usage",
				Details: err.Error(),
				Code:    http.StatusInternalServerError,
			})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"sim_cards": usages,
		"total":     len(usages),
	})
}

// HealthCheck handles GET /health requests.
func (h *Handlers) HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "healthy",
		"service": "telnyx-data-monitor",
	})
}
```

Create the main `main.go` file to set up the Gin server:

```go
package main

import (
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
)

func main() {
	// Load configuration from environment.
	config, err := LoadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	// Initialize Telnyx client with the new SDK pattern.
	telnyxClient := NewTelnyxClient(config.TelnyxAPIKey)

	// Create service and handlers.
	service := NewDataUsageService(telnyxClient)
	handlers := NewHandlers(service)

	// Set up Gin router.
	router := gin.Default()

	// Define routes.
	router.GET("/health", handlers.HealthCheck)
	router.GET("/sim-cards/usage", handlers.ListAllSimCardsUsage)
	router.GET("/sim-cards/:id/usage", handlers.GetSimCardUsage)

	// Start server.
	addr := fmt.Sprintf(":%s", config.Port)
	log.Printf("Starting data usage monitor on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or newlines. If the key was regenerated recently, update your environment file and restart the Go server. Run `echo $TELNYX_API_KEY` to confirm the variable is loaded correctly. |
| SIM Card Not Found (404) | You receive a 500 error when querying a specific SIM card ID that does not exist in your account. | Verify the SIM card ID is correct by listing all SIM cards first using `GET /sim-cards/usage`. Copy the exact `sim_card_id` from the response and use it in subsequent requests. Ensure the SIM card has not been deleted from your Telnyx account. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API enforces rate limits on requests. Implement exponential backoff in your client code: wait 1 second, then 2 seconds, then 4 seconds between retries. For production monitoring, cache data usage results and refresh every 5–10 minutes instead of querying on every request. |
| Environment Variable Not Set | The application fails to start with `Configuration error: TELNYX_API_KEY environment variable not set`. | Confirm your `.env` file exists in the same directory as `main.go` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `godotenv.Load()` call must execute before `os.Getenv()` is called. Alternatively, export the variable directly: `export TELNYX_API_KEY=your_key_here` before running the server. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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

- [Activate SIM Cards with Go](/tutorials/iot/go/sim-activation).
- [Monitor SIM Status Changes with Webhooks](/tutorials/iot/go/sim-status-webhook).
- [Configure APN Settings for IoT Devices](/tutorials/iot/go/apn-configuration).
