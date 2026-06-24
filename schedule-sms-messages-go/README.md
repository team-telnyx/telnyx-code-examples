# Scheduled SMS with Go and Gin

## What Does This Example Do?

Build a production-ready Gin web service that schedules SMS messages for future delivery using the Telnyx Go SDK. This tutorial demonstrates scheduling patterns with persistent storage, proper error handling for telecom APIs, and secure credential management via environment variables. You'll create endpoints to schedule messages, list pending deliveries, and handle webhook callbacks for delivery status updates.

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
- A Telnyx phone number enabled for outbound SMS.
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).
- Basic familiarity with Go and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/schedule-sms-messages-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create the data models in `pkg/models/models.go`:

```go
package models

import (
	"time"
)

// ScheduledMessage represents an SMS scheduled for future delivery.
type ScheduledMessage struct {
	ID          string    `json:"id"`
	To          string    `json:"to"`
	Message     string    `json:"message"`
	ScheduledAt time.Time `json:"scheduled_at"`
	Status      string    `json:"status"` // pending, sent, failed, delivered
	MessageID   string    `json:"message_id,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	Error       string    `json:"error,omitempty"`
}

// SendSMSRequest represents the incoming request to schedule an SMS.
type SendSMSRequest struct {
	To          string `json:"to" binding:"required"`
	Message     string `json:"message" binding:"required"`
	ScheduledAt string `json:"scheduled_at" binding:"required"` // RFC3339 format
}

// WebhookPayload represents the Telnyx webhook event for message status.
type WebhookPayload struct {
	Data struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		To     []struct {
			Status string `json:"status"`
		} `json:"to"`
	} `json:"data"`
}
```

Create the scheduler service in `pkg/scheduler/scheduler.go`:

```go
package scheduler

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/team-telnyx/telnyx-go/v4"
	"github.com/team-telnyx/telnyx-go/v4/v2/messaging"
	"telnyx-scheduled-sms/pkg/models"
)

// Scheduler manages scheduled SMS messages.
type Scheduler struct {
	client   *telnyx.Client
	messages map[string]*models.ScheduledMessage
	mu       sync.RWMutex
	ticker   *time.Ticker
	done     chan bool
}

// NewScheduler creates a new scheduler instance.
func NewScheduler(apiKey string) *Scheduler {
	client := telnyx.NewClient(telnyx.WithAPIKey(apiKey))
	return &Scheduler{
		client:   client,
		messages: make(map[string]*models.ScheduledMessage),
		ticker:   time.NewTicker(10 * time.Second), // Check every 10 seconds
		done:     make(chan bool),
	}
}

// Start begins the scheduler loop that checks for messages to send.
func (s *Scheduler) Start() {
	go func() {
		for {
			select {
			case <-s.ticker.C:
				s.processPendingMessages()
			case <-s.done:
				return
			}
		}
	}()
}

// Stop halts the scheduler.
func (s *Scheduler) Stop() {
	s.ticker.Stop()
	s.done <- true
}

// ScheduleMessage adds a new message to the queue.
func (s *Scheduler) ScheduleMessage(to, message, scheduledAtStr string) (*models.ScheduledMessage, error) {
	// Parse the scheduled time in RFC3339 format.
	scheduledAt, err := time.Parse(time.RFC3339, scheduledAtStr)
	if err != nil {
		return nil, fmt.Errorf("invalid scheduled_at format: %w", err)
	}

	// Validate that the scheduled time is in the future.
	if scheduledAt.Before(time.Now()) {
		return nil, fmt.Errorf("scheduled_at must be in the future")
	}

	// Validate E.164 format.
	if to[0] != '+' {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	sm := &models.ScheduledMessage{
		ID:          uuid.New().String(),
		To:          to,
		Message:     message,
		ScheduledAt: scheduledAt,
		Status:      "pending",
		CreatedAt:   time.Now(),
	}

	s.mu.Lock()
	s.messages[sm.ID] = sm
	s.mu.Unlock()

	return sm, nil
}

// GetMessage retrieves a scheduled message by ID.
func (s *Scheduler) GetMessage(id string) (*models.ScheduledMessage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	msg, exists := s.messages[id]
	if !exists {
		return nil, fmt.Errorf("message not found")
	}
	return msg, nil
}

// ListMessages returns all scheduled messages.
func (s *Scheduler) ListMessages() []*models.ScheduledMessage {
	s.mu.RLock()
	defer s.mu.RUnlock()

	messages := make([]*models.ScheduledMessage, 0, len(s.messages))
	for _, msg := range s.messages {
		messages = append(messages, msg)
	}
	return messages
}

// processPendingMessages checks for messages ready to send.
func (s *Scheduler) processPendingMessages() {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	for _, msg := range s.messages {
		// Only process pending messages that have reached their scheduled time.
		if msg.Status == "pending" && msg.ScheduledAt.Before(now) {
			go s.sendMessage(msg)
		}
	}
}

// sendMessage sends a single message via Telnyx API.
func (s *Scheduler) sendMessage(msg *models.ScheduledMessage) {
	fromNumber := os.Getenv("TELNYX_PHONE_NUMBER")
	if fromNumber == "" {
		msg.Status = "failed"
		msg.Error = "TELNYX_PHONE_NUMBER not configured"
		return
	}

	// Create the message using the Telnyx SDK.
	params := &messaging.CreateMessageParams{
		From: fromNumber,
		To:   msg.To,
		Text: msg.Message,
	}

	response, err := s.client.Messages.Create(context.Background(), params)
	if err != nil {
		msg.Status = "failed"
		msg.Error = err.Error()
		return
	}

	// Extract the message ID from the response.
	if response != nil && response.Data != nil {
		msg.MessageID = response.Data.ID
		msg.Status = "sent"
	}
}

// UpdateMessageStatus updates the status of a message based on webhook data.
func (s *Scheduler) UpdateMessageStatus(messageID, status string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, msg := range s.messages {
		if msg.MessageID == messageID {
			msg.Status = status
			return nil
		}
	}
	return fmt.Errorf("message with ID %s not found", messageID)
}
```

Create the main application in `cmd/server/main.go`:

```go
package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4"
	"telnyx-scheduled-sms/pkg/models"
	"telnyx-scheduled-sms/pkg/scheduler"
)

var sched *scheduler.Scheduler

func init() {
	// Load environment variables from .env file.
	godotenv.Load()
}

func main() {
	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		fmt.Fprintf(os.Stderr, "Error: TELNYX_API_KEY environment variable not set\n")
		os.Exit(1)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Initialize the scheduler.
	sched = scheduler.NewScheduler(apiKey)
	sched.Start()
	defer sched.Stop()

	// Create Gin router.
	r := gin.Default()

	// Routes
	r.POST("/sms/schedule", scheduleMessageHandler)
	r.GET("/sms/scheduled", listMessagesHandler)
	r.GET("/sms/scheduled/:id", getMessageHandler)
	r.POST("/webhooks/sms", webhookHandler)

	// Start server.
	fmt.Printf("Starting server on port %s\n", port)
	if err := r.Run(":" + port); err != nil {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}

// scheduleMessageHandler handles POST /sms/schedule requests.
func scheduleMessageHandler(c *gin.Context) {
	var req models.SendSMSRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid request: %v", err)})
		return
	}

	msg, err := sched.ScheduleMessage(req.To, req.Message, req.ScheduledAt)
	if err != nil {
		// Handle validation errors.
		if err.Error() == "scheduled_at must be in the future" {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err.Error() == "invalid scheduled_at format: parsing time" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "scheduled_at must be in RFC3339 format (e.g., 2026-06-24T15:30:00Z)"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":           msg.ID,
		"to":           msg.To,
		"message":      msg.Message,
		"scheduled_at": msg.ScheduledAt,
		"status":       msg.Status,
		"created_at":   msg.CreatedAt,
	})
}

// listMessagesHandler handles GET /sms/scheduled requests.
func listMessagesHandler(c *gin.Context) {
	messages := sched.ListMessages()

	// Convert to JSON-serializable format.
	result := make([]map[string]interface{}, 0, len(messages))
	for _, msg := range messages {
		result = append(result, map[string]interface{}{
			"id":           msg.ID,
			"to":           msg.To,
			"message":      msg.Message,
			"scheduled_at": msg.ScheduledAt,
			"status":       msg.Status,
			"message_id":   msg.MessageID,
			"created_at":   msg.CreatedAt,
			"error":        msg.Error,
		})
	}

	c.JSON(http.StatusOK, result)
}

// getMessageHandler handles GET /sms/scheduled/:id requests.
func getMessageHandler(c *gin.Context) {
	id := c.Param("id")

	msg, err := sched.GetMessage(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":           msg.ID,
		"to":           msg.To,
		"message":      msg.Message,
		"scheduled_at": msg.ScheduledAt,
		"status":       msg.Status,
		"message_id":   msg.MessageID,
		"created_at":   msg.CreatedAt,
		"error":        msg.Error,
	})
}

// webhookHandler handles POST /webhooks/sms requests from Telnyx.
func webhookHandler(c *gin.Context) {
	var payload models.WebhookPayload

	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	// Extract message ID and status from the webhook.
	messageID := payload.Data.ID
	status := payload.Data.Status

	// If status is not set at the top level, check the 'to' array.
	if status == "" && len(payload.Data.To) > 0 {
		status = payload.Data.To[0].Status
	}

	// Update the message status in the scheduler.
	if err := sched.UpdateMessageStatus(messageID, status); err != nil {
		// Message not found in our scheduler — this is expected for messages
		// sent outside this service. Log and acknowledge the webhook.
		fmt.Printf("Webhook received for unknown message: %s\n", messageID)
	}

	// Always return 200 to acknowledge the webhook.
	c.JSON(http.StatusOK, gin.H{"status": "received"})
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/schedule-sms-messages-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The scheduler fails to send messages with "Invalid API key" error. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the server after updating the `.env` file. |
| Invalid Phone Number Format | The endpoint returns a 400 error stating "phone number must be in E.164 format". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Scheduled Time in the Past | The endpoint returns a 400 error stating "scheduled_at must be in the future". | Ensure the `scheduled_at` timestamp is in the future relative to the server's current time. Use RFC3339 format (e.g., `2026-06-24T15:30:00Z`). Check that your server's system clock is accurate. |
| Messages Not Sending | Messages remain in "pending" status and never transition to "sent". | Verify that `TELNYX_PHONE_NUMBER` is set in the `.env` file and is a valid Telnyx phone number. Check the message's `error` field in the response to see the specific failure reason. Ensure your Telnyx account has sufficient credits and the phone number is enabled for outbound SMS. |
| Webhook Not Updating Status | Delivery status updates from Telnyx webhooks are not reflected in the scheduler. | Confirm that your webhook URL is publicly accessible and matches the URL configured in your Telnyx Messaging Profile. Test the webhook endpoint manually using curl to ensure it accepts POST requests. Check that the webhook payload structure matches the expected format in the `WebhookPayload` struct. |

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

- [Send a Single SMS with Go and
