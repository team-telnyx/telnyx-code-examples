# SMS Survey with Go and Gin

## What Does This Example Do?

Build a production-ready SMS survey system using Go and the Gin web framework. This tutorial demonstrates how to send survey questions via SMS, collect responses through inbound webhooks, and track survey progress using the Telnyx SMS API. You'll learn proper error handling for telecom APIs, webhook validation, and secure credential management.

## Who Is This For?

- **Go developers** building sms features with Gin.
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
- A Telnyx phone number enabled for inbound and outbound SMS.
- A publicly accessible URL for webhook callbacks (use ngrok for local development).
- Basic familiarity with Go and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-survey-bot-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `survey.go` to handle survey logic and SMS operations:

```go
package main

import (
	"fmt"

	"github.com/team-telnyx/telnyx-go/v4/v2"
	"github.com/team-telnyx/telnyx-go/v4/v2/messaging"
)

var surveyQuestions = []string{
	"How satisfied are you with our service? Reply 1-5.",
	"Would you recommend us to a friend? Reply YES or NO.",
	"What could we improve? Reply with your feedback.",
}

func sendSurveyQuestion(toNumber string, questionIndex int) error {
	client := telnyx.NewClient(telnyx.WithAPIKey(getAPIKey()))
	fromNumber := getPhoneNumber()

	if fromNumber == "" {
		return fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}

	if !isValidE164(toNumber) {
		return fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	if questionIndex < 0 || questionIndex >= len(surveyQuestions) {
		return fmt.Errorf("invalid question index: %d", questionIndex)
	}

	messageText := surveyQuestions[questionIndex]

	params := &messaging.CreateMessageParams{
		From: fromNumber,
		To:   toNumber,
		Text: messageText,
	}

	response, err := client.Messages.CreateMessage(params)
	if err != nil {
		return fmt.Errorf("failed to send SMS: %w", err)
	}

	if response == nil || response.Data == nil {
		return fmt.Errorf("empty response from Telnyx API")
	}

	return nil
}

func startSurvey(toNumber string) error {
	// Send the first survey question
	return sendSurveyQuestion(toNumber, 0)
}

func sendNextQuestion(toNumber string) error {
	responses := surveyState.getResponses(toNumber)
	nextQuestionIndex := len(responses)

	if nextQuestionIndex >= len(surveyQuestions) {
		// Survey complete — send thank you message
		client := telnyx.NewClient(telnyx.WithAPIKey(getAPIKey()))
		fromNumber := getPhoneNumber()

		params := &messaging.CreateMessageParams{
			From: fromNumber,
			To:   toNumber,
			Text: "Thank you for completing our survey!",
		}

		_, err := client.Messages.CreateMessage(params)
		return err
	}

	return sendSurveyQuestion(toNumber, nextQuestionIndex)
}

func isValidE164(phoneNumber string) bool {
	if len(phoneNumber) < 10 || len(phoneNumber) > 15 {
		return false
	}
	if phoneNumber[0] != '+' {
		return false
	}
	for _, ch := range phoneNumber[1:] {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}
```

Create `handlers.go` to define HTTP endpoints:

```go
package main

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4/v2"
)

type StartSurveyRequest struct {
	PhoneNumber string `json:"phone_number" binding:"required"`
}

type WebhookPayload struct {
	Data struct {
		ID        string `json:"id"`
		Direction string `json:"direction"`
		From      struct {
			PhoneNumber string `json:"phone_number"`
		} `json:"from"`
		Text string `json:"text"`
	} `json:"data"`
	EventType string `json:"event_type"`
}

// StartSurveyHandler initiates a survey for a given phone number.
func StartSurveyHandler(c *gin.Context) {
	var req StartSurveyRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required field: phone_number"})
		return
	}

	if !isValidE164(req.PhoneNumber) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number must be in E.164 format (e.g., +15551234567)"})
		return
	}

	if err := startSurvey(req.PhoneNumber); err != nil {
		handleSMSError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      "Survey started",
		"phone_number": req.PhoneNumber,
		"question":     1,
	})
}

// WebhookHandler processes inbound SMS responses.
func WebhookHandler(c *gin.Context) {
	var payload WebhookPayload

	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	// Only process inbound messages
	if payload.EventType != "message.received" || payload.Data.Direction != "inbound" {
		c.JSON(http.StatusOK, gin.H{"status": "ignored"})
		return
	}

	phoneNumber := payload.Data.From.PhoneNumber
	answer := strings.TrimSpace(payload.Data.Text)

	// Record the response
	responses := surveyState.getResponses(phoneNumber)
	surveyResponse := SurveyResponse{
		PhoneNumber: phoneNumber,
		Question:    len(responses) + 1,
		Answer:      answer,
	}
	surveyState.addResponse(phoneNumber, surveyResponse)

	// Send the next question or completion message
	if err := sendNextQuestion(phoneNumber); err != nil {
		// Log error but still return 200 to acknowledge webhook receipt
		c.JSON(http.StatusOK, gin.H{
			"status": "response_recorded",
			"error":  err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":       "response_recorded",
		"phone_number": phoneNumber,
		"question":     len(responses) + 1,
	})
}

// GetSurveyResultsHandler retrieves all survey responses.
func GetSurveyResultsHandler(c *gin.Context) {
	allResponses := surveyState.getAllResponses()

	// Convert to JSON-serializable format
	results := make(map[string]interface{})
	for phoneNumber, responses := range allResponses {
		responseList := make([]map[string]interface{}, len(responses))
		for i, resp := range responses {
			responseList[i] = map[string]interface{}{
				"question": resp.Question,
				"answer":   resp.Answer,
			}
		}
		results[phoneNumber] = responseList
	}

	c.JSON(http.StatusOK, gin.H{
		"total_respondents": len(allResponses),
		"responses":         results,
	})
}

// handleSMSError maps Telnyx SDK errors to HTTP status codes.
func handleSMSError(c *gin.Context, err error) {
	switch err.(type) {
	case *telnyx.AuthenticationError:
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
	case *telnyx.RateLimitError:
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
	case *telnyx.APIStatusError:
		apiErr := err.(*telnyx.APIStatusError)
		c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error(), "status_code": apiErr.StatusCode})
	case *telnyx.APIConnectionError:
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	}
}
```

Create `main.go` to set up the Gin server:

```go
package main

import (
	"log"

	"github.com/gin-gonic/gin"
)

func main() {
	// Verify required environment variables
	if getAPIKey() == "" {
		log.Fatal("TELNYX_API_KEY environment variable not set")
	}
	if getPhoneNumber() == "" {
		log.Fatal("TELNYX_PHONE_NUMBER environment variable not set")
	}

	// Create Gin router
	router := gin.Default()

	// Define routes
	router.POST("/surveys/start", StartSurveyHandler)
	router.POST("/webhooks/sms", WebhookHandler)
	router.GET("/surveys/results", GetSurveyResultsHandler)

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	log.Println("Starting SMS survey server on :8080")
	if err := router.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-survey-bot-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Go server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Not Receiving Messages | The `/webhooks/sms` endpoint is not being called when inbound SMS arrives. | Verify that your ngrok tunnel is active and the URL is correctly configured in your Telnyx Messaging Profile. Check that the webhook URL in the portal matches your ngrok URL exactly (e.g., `https://your-ngrok-url.ngrok.io/webhooks/sms`). Ensure your firewall allows inbound HTTPS traffic on port 8080. |
| Survey Responses Not Persisting | Survey responses are recorded but disappear after server restart. | This is expected behavior—responses are stored in memory. For production, implement persistent storage using a database like PostgreSQL or MongoDB. Update the `SurveyState` struct to use database operations instead of the in-memory map. |
| Rate Limit Errors (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx enforces rate limits on API calls. Implement exponential backoff retry logic or queue survey requests. Space out survey initiations to avoid hitting limits. Check your Telnyx account plan for rate limit details in the portal. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Go version do I need?**

Go 1.22 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Receive SMS Webhooks with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/receive-sms-webhook).
- [Send Bulk SMS Messages with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS and Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/otp-2fa).
