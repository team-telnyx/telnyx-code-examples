package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4"
	"github.com/team-telnyx/telnyx-go/v4/v2/messaging"
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

// Scheduler manages scheduled SMS messages.
type Scheduler struct {
	client   *telnyx.Client
	messages map[string]*ScheduledMessage
	mu       sync.RWMutex
	ticker   *time.Ticker
	done     chan bool
}

// NewScheduler creates a new scheduler instance.
func NewScheduler(apiKey string) *Scheduler {
	client := telnyx.NewClient(telnyx.WithAPIKey(apiKey))
	return &Scheduler{
		client:   client,
		messages: make(map[string]*ScheduledMessage),
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
func (s *Scheduler) ScheduleMessage(to, message, scheduledAtStr string) (*ScheduledMessage, error) {
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

	sm := &ScheduledMessage{
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
func (s *Scheduler) GetMessage(id string) (*ScheduledMessage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	msg, exists := s.messages[id]
	if !exists {
		return nil, fmt.Errorf("message not found")
	}
	return msg, nil
}

// ListMessages returns all scheduled messages.
func (s *Scheduler) ListMessages() []*ScheduledMessage {
	s.mu.RLock()
	defer s.mu.RUnlock()

	messages := make([]*ScheduledMessage, 0, len(s.messages))
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
func (s *Scheduler) sendMessage(msg *ScheduledMessage) {
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

var sched *Scheduler

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
	var req SendSMSRequest

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
	var payload WebhookPayload

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
