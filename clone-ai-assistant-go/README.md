# Clone AI Assistant with Go and Gin

## What Does This Example Do?

Build a production-ready Gin endpoint that clones an existing AI Assistant using the Telnyx Go SDK. This tutorial demonstrates how to duplicate an assistant's configuration, including its model, instructions, and tools, enabling rapid deployment of similar assistants for different use cases. You'll learn proper error handling for the Telnyx API, secure credential management, and JSON serialization patterns in Gin.

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
- An existing AI Assistant to clone (see [Create an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/go/create-ai-assistant) if you need to create one first).
- Basic familiarity with Go and the Gin web framework.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/clone-ai-assistant-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` with a helper function to clone an assistant and a Gin route handler:

```go
package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4"
)

// CloneAssistantRequest represents the incoming request payload.
type CloneAssistantRequest struct {
	AssistantID string `json:"assistant_id" binding:"required"`
	NewName     string `json:"new_name" binding:"required"`
}

// AssistantResponse represents the cloned assistant data for JSON serialization.
type AssistantResponse struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Model            string   `json:"model"`
	Instructions     string   `json:"instructions"`
	EnabledFeatures  []string `json:"enabled_features"`
	CreatedAt        string   `json:"created_at"`
	SourceAssistantID string  `json:"source_assistant_id"`
}

// cloneAssistant clones an existing assistant with a new name.
// Returns the cloned assistant data or an error.
func cloneAssistant(assistantID string, newName string) (*AssistantResponse, error) {
	// Call the Telnyx API to clone the assistant
	response, err := client.AIAssistants.Clone(assistantID, &telnyx.AIAssistantCloneParams{
		Name: telnyx.F(newName),
	})
	if err != nil {
		return nil, err
	}

	// Extract serializable data from the SDK response
	// SDK objects are NOT JSON-serializable, so we unpack to a plain struct
	clonedAssistant := &AssistantResponse{
		ID:               response.Result.ID,
		Name:             response.Result.Name,
		Model:            response.Result.Model,
		Instructions:     response.Result.Instructions,
		EnabledFeatures:  response.Result.EnabledFeatures,
		CreatedAt:        response.Result.CreatedAt.String(),
		SourceAssistantID: assistantID,
	}

	return clonedAssistant, nil
}

// setupRoutes configures all Gin routes with error handling.
func setupRoutes(router *gin.Engine) {
	router.POST("/assistants/clone", cloneAssistantHandler)
}

// cloneAssistantHandler is the HTTP endpoint to clone an AI Assistant.
// Catches Telnyx exceptions and maps them to appropriate HTTP status codes.
func cloneAssistantHandler(c *gin.Context) {
	var req CloneAssistantRequest

	// Parse and validate the incoming JSON request
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid request body: " + err.Error(),
		})
		return
	}

	// Validate that assistant_id is not empty
	if req.AssistantID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "assistant_id cannot be empty",
		})
		return
	}

	// Validate that new_name is not empty
	if req.NewName == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "new_name cannot be empty",
		})
		return
	}

	// Call the helper function to clone the assistant
	clonedAssistant, err := cloneAssistant(req.AssistantID, req.NewName)

	// Handle Telnyx API errors with appropriate HTTP status codes
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
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "An unexpected error occurred: " + err.Error(),
			})
			return
		}
	}

	// Return the cloned assistant data as JSON
	c.JSON(http.StatusOK, clonedAssistant)
}

func main() {
	// Create a new Gin router with default middleware
	router := gin.Default()

	// Setup all routes
	setupRoutes(router)

	// Start the HTTP server on port 8080
	log.Println("Starting server on :8080")
	if err := router.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/clone-ai-assistant-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or newlines. If the key was regenerated recently, update your `.env` file and restart the Gin server with `go run main.go config.go`. |
| Assistant Not Found (404) | The API returns a 404 error stating the assistant does not exist. | Confirm the `assistant_id` you're cloning actually exists in your Telnyx account. Retrieve a list of your assistants using the [List AI Assistants](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/go/list-ai-assistants) endpoint to verify the ID. Ensure you're using the correct ID format without extra whitespace. |
| Missing Required Fields (400) | The endpoint returns `{"error": "assistant_id cannot be empty"}` or similar validation error. | Ensure your JSON request body includes both `assistant_id` and `new_name` fields with non-empty string values. Example: `{"assistant_id": "abc123", "new_name": "My Cloned Assistant"}`. Check that the Content-Type header is set to `application/json`. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | You've exceeded the Telnyx API rate limit. Wait a few seconds before retrying. Implement exponential backoff in production code to handle rate limiting gracefully. Check the [Telnyx documentation](https://developers.telnyx.com) for current rate limit thresholds. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | The Telnyx API is temporarily unavailable or your network connection is down. Verify your internet connectivity and check the [Telnyx status page](https://status.telnyx.com). Retry the request after a short delay. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this AI example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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

- [List AI Assistants](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/go/list-ai-assistants).
- [Get an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/go/get-ai-assistant).
- [Chat with an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/go/chat-with-ai-assistant).
