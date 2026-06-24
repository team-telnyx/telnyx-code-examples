# Create AI Assistant with Go and Gin

## What Does This Example Do?

Build a production-ready Gin endpoint that creates AI assistants using the Telnyx Go SDK. This tutorial demonstrates the client initialization pattern, proper error handling for telecom APIs, request validation, and secure credential management via environment variables. You'll learn how to configure an AI assistant with custom instructions and enable it for voice or messaging features.

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
cd telnyx-code-examples/create-ai-assistant-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `assistant.go` to define the helper function that creates an AI assistant:

```go
package main

import (
	"context"
	"fmt"

	"github.com/telnyx/telnyx-go/v2"
)

// CreateAssistantRequest represents the input for creating an AI assistant.
type CreateAssistantRequest struct {
	Name             string   `json:"name" binding:"required"`
	Model            string   `json:"model" binding:"required"`
	Instructions     string   `json:"instructions"`
	EnabledFeatures  []string `json:"enabled_features"`
}

// AssistantResponse represents the JSON-serializable response data.
type AssistantResponse struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Model            string   `json:"model"`
	Instructions     string   `json:"instructions"`
	EnabledFeatures  []string `json:"enabled_features"`
	CreatedAt        string   `json:"created_at"`
}

// CreateAssistant creates a new AI assistant via the Telnyx API.
// Returns a JSON-serializable response or an error.
func CreateAssistant(client *telnyx.Client, req CreateAssistantRequest) (*AssistantResponse, error) {
	// Validate required fields
	if req.Name == "" {
		return nil, fmt.Errorf("assistant name is required")
	}
	if req.Model == "" {
		return nil, fmt.Errorf("model is required")
	}

	// Build the create request with optional fields
	params := telnyx.AIAssistantCreateParams{
		Name:  telnyx.F(req.Name),
		Model: telnyx.F(req.Model),
	}

	if req.Instructions != "" {
		params.Instructions = telnyx.F(req.Instructions)
	}

	if len(req.EnabledFeatures) > 0 {
		params.EnabledFeatures = telnyx.F(req.EnabledFeatures)
	}

	// Call the API — use client.AIAssistants.New() for creation
	response, err := client.AIAssistants.New(context.Background(), params)
	if err != nil {
		return nil, err
	}

	// Extract serializable data from the SDK response object
	return &AssistantResponse{
		ID:              response.ID,
		Name:            response.Name,
		Model:           response.Model,
		Instructions:    response.Instructions,
		EnabledFeatures: response.EnabledFeatures,
		CreatedAt:       response.CreatedAt.String(),
	}, nil
}
```

Create `main.go` to set up the Gin server with the create assistant endpoint:

```go
package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/telnyx/telnyx-go/v2"
)

func main() {
	// Initialize Telnyx client
	client := InitClient()

	// Create Gin router
	router := gin.Default()

	// POST /assistants — create a new AI assistant
	router.POST("/assistants", func(c *gin.Context) {
		var req CreateAssistantRequest

		// Bind and validate JSON request body
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid request body: " + err.Error(),
			})
			return
		}

		// Call helper function — exception handling happens here in the route
		response, err := CreateAssistant(client, req)

		// Handle Telnyx-specific errors
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
				// Generic validation or other errors
				c.JSON(http.StatusBadRequest, gin.H{
					"error": err.Error(),
				})
				return
			}
		}

		// Return the created assistant as JSON
		c.JSON(http.StatusCreated, response)
	})

	// Start the server
	log.Println("Starting server on :8080")
	if err := router.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or extra characters. If the key was regenerated recently, update your environment file and restart the Gin server. |
| Invalid Request Body (400) | You receive a 400 error stating "Invalid request body" or missing required fields. | Ensure your JSON payload includes both `name` and `model` fields. Verify the JSON is valid by using a JSON validator. Check that the Content-Type header is set to `application/json`. Example valid payload: `{"name": "Bot", "model": "meta-llama/Meta-Llama-3.1-70B-Instruct"}`. |
| Model Not Recognized | The API returns an error about an unsupported or invalid model. | Use a supported LLM model identifier such as `meta-llama/Meta-Llama-3.1-70B-Instruct` or `gpt-4`. Verify the model name is spelled correctly and is available in your Telnyx account. Check the [Telnyx AI Assistants documentation](https://portal.telnyx.com) for the current list of supported models. |
| Environment Variable Not Set | The application exits with "TELNYX_API_KEY environment variable not set". | Confirm your `.env` file exists in the same directory as your Go binary and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt`). The `godotenv.Load()` call must execute before `os.Getenv()` is called. For production, set the environment variable directly in your deployment environment instead of using a `.env` file. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection is active and can reach the Telnyx API. Check if the Telnyx service is operational by visiting the [Telnyx Status Page](https://status.telnyx.com). If behind a corporate firewall, ensure outbound HTTPS traffic to `api.telnyx.com` is allowed. |

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

- [List AI Assistants](/tutorials/ai/go/list-ai-assistants).
- [Get an AI Assistant](/tutorials/ai/go/get-ai-assistant).
- [Chat with an AI Assistant](/tutorials/ai/go/chat-with-ai-assistant).
