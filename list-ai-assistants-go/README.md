# List AI Assistants with Go and Gin

## What Does This Example Do?

Build a production-ready Gin endpoint that lists all AI assistants in your Telnyx account using the Telnyx Go SDK. This tutorial demonstrates proper client initialization, pagination handling, secure credential management via environment variables, and comprehensive error handling for production resilience.

## Who Is This For?

- **Go developers** building ai features with Gin.
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
- Basic familiarity with Go and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/list-ai-assistants-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/list-ai-assistants-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` and initialize the Telnyx client using the Go SDK pattern. Define a helper function to fetch and serialize assistants:

```go
package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2"
)

// AssistantResponse represents a serializable AI assistant object.
type AssistantResponse struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Model            string   `json:"model"`
	Instructions     string   `json:"instructions"`
	EnabledFeatures  []string `json:"enabled_features"`
	CreatedAt        string   `json:"created_at"`
}

// ListAssistantsResponse wraps the list of assistants with pagination metadata.
type ListAssistantsResponse struct {
	Data       []AssistantResponse `json:"data"`
	PageNumber int                 `json:"page_number"`
	PageSize   int                 `json:"page_size"`
	Total      int                 `json:"total"`
}

func init() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}
}

// listAssistants fetches all AI assistants from Telnyx and returns serializable data.
// Handles pagination to retrieve all assistants across multiple pages.
func listAssistants(pageNumber, pageSize int) (*ListAssistantsResponse, error) {
	// Initialize client with API key from environment
	client := telnyx.NewClient(option.WithAPIKey(os.Getenv("TELNYX_API_KEY")))

	// Fetch assistants with pagination parameters
	params := &v2.ListAIAssistantsParams{
		PageNumber: pageNumber,
		PageSize:   pageSize,
	}

	response, err := client.AIAssistants.List(params)
	if err != nil {
		return nil, err
	}

	// Serialize SDK response objects to plain maps — SDK objects are NOT JSON-serializable
	assistants := make([]AssistantResponse, 0, len(response.Data))
	for _, assistant := range response.Data {
		assistants = append(assistants, AssistantResponse{
			ID:              assistant.ID,
			Name:            assistant.Name,
			Model:           assistant.Model,
			Instructions:    assistant.Instructions,
			EnabledFeatures: assistant.EnabledFeatures,
			CreatedAt:       assistant.CreatedAt,
		})
	}

	return &ListAssistantsResponse{
		Data:       assistants,
		PageNumber: pageNumber,
		PageSize:   pageSize,
		Total:      response.Meta.Total,
	}, nil
}

func main() {
	// Initialize Gin router
	router := gin.Default()

	// Define error handler middleware for Telnyx exceptions
	router.Use(func(c *gin.Context) {
		c.Next()
		// Error handling is done in individual route handlers
	})

	// GET /assistants — list all AI assistants with pagination support
	router.GET("/assistants", func(c *gin.Context) {
		// Parse pagination parameters from query string
		pageNumber := 1
		pageSize := 10

		if page := c.Query("page"); page != "" {
			if p, err := strconv.Atoi(page); err == nil && p > 0 {
				pageNumber = p
			}
		}

		if size := c.Query("page_size"); size != "" {
			if s, err := strconv.Atoi(size); err == nil && s > 0 && s <= 100 {
				pageSize = s
			}
		}

		// Call helper function to fetch assistants
		result, err := listAssistants(pageNumber, pageSize)

		// Handle Telnyx-specific errors with appropriate HTTP status codes
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
				statusErr := err.(*telnyx.APIStatusError)
				c.JSON(statusErr.StatusCode, gin.H{
					"error":       statusErr.Error(),
					"status_code": statusErr.StatusCode,
				})
				return
			case *telnyx.APIConnectionError:
				c.JSON(http.StatusServiceUnavailable, gin.H{
					"error": "Network error connecting to Telnyx",
				})
				return
			default:
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": fmt.Sprintf("Unexpected error: %v", err),
				})
				return
			}
		}

		// Return serialized response
		c.JSON(http.StatusOK, result)
	})

	// GET /assistants/:id — retrieve a single assistant by ID
	router.GET("/assistants/:id", func(c *gin.Context) {
		assistantID := c.Param("id")

		if assistantID == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Assistant ID is required",
			})
			return
		}

		// Initialize client and fetch single assistant
		client := telnyx.NewClient(option.WithAPIKey(os.Getenv("TELNYX_API_KEY")))
		response, err := client.AIAssistants.Get(assistantID)

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
				statusErr := err.(*telnyx.APIStatusError)
				c.JSON(statusErr.StatusCode, gin.H{
					"error":       statusErr.Error(),
					"status_code": statusErr.StatusCode,
				})
				return
			case *telnyx.APIConnectionError:
				c.JSON(http.StatusServiceUnavailable, gin.H{
					"error": "Network error connecting to Telnyx",
				})
				return
			default:
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": fmt.Sprintf("Unexpected error: %v", err),
				})
				return
			}
		}

		// Serialize single assistant response
		assistant := AssistantResponse{
			ID:              response.Data.ID,
			Name:            response.Data.Name,
			Model:           response.Data.Model,
			Instructions:    response.Data.Instructions,
			EnabledFeatures: response.Data.EnabledFeatures,
			CreatedAt:       response.Data.CreatedAt,
		}

		c.JSON(http.StatusOK, assistant)
	})

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
		})
	})

	// Start server on configured port
	port := os.Getenv("GIN_PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting Gin server on port %s\n", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/list-ai-assistants-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or newlines. If the key was regenerated recently, update your environment file and restart the Gin server. Run `echo $TELNYX_API_KEY` to confirm the variable is loaded correctly. |
| No Assistants Returned | The endpoint returns an empty list `{"data": [], "page_number": 1, "page_size": 10, "total": 0}`. | This is expected if you have not created any AI assistants yet. Create an assistant using the Telnyx Portal or the [Create AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/go/create-ai-assistant) tutorial, then retry the list endpoint. |
| Environment Variable Not Set | The application fails with an error about missing `TELNYX_API_KEY` or returns a 401 error immediately. | Confirm your `.env` file exists in the same directory as `main.go` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `godotenv.Load()` call must execute before `os.Getenv()` is called—verify this import order in your code. Alternatively, set the environment variable directly: `export TELNYX_API_KEY=your_key_here`. |
| Pagination Not Working | Query parameters like `?page=2` are ignored and always return page 1. | Verify the query parameter names are lowercase: `page` and `page_size`. The code validates that `page > 0` and `0 < page_size <= 100`. If you pass invalid values (e.g., `page=0` or `page_size=200`), they are silently ignored and defaults are used. Check your curl command syntax: `curl "http://localhost:8080/assistants?page=2&page_size=5"` (note the quotes around the URL). |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection is active and you can reach `api.telnyx.com`. Check if your firewall or proxy is blocking outbound HTTPS connections. Ensure the Telnyx API is not experiencing an outage by checking the [Telnyx Status Page](https://status.telnyx.com). |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this AI example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Go version do I need?**

Go 1.22 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Assistants API Reference](https://developers.telnyx.com/api-reference/assistants/create-an-assistant)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx AI Assistants](https://telnyx.com/ai-assistants)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [Get an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/go/get-ai-assistant).
- [Create an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/go/create-ai-assistant).
- [Chat with an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/go/chat-with-ai-assistant).
