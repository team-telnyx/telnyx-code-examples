package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go/v2"
	"github.com/telnyx/telnyx-go/v2/client/option"
)

// Config holds application configuration.
type Config struct {
	APIKey      string
	PhoneNumber string
	WebhookURL  string
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() (*Config, error) {
	_ = godotenv.Load()

	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("TELNYX_API_KEY environment variable not set")
	}

	phoneNumber := os.Getenv("TELNYX_PHONE_NUMBER")
	if phoneNumber == "" {
		return nil, fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}

	webhookURL := os.Getenv("WEBHOOK_URL")
	if webhookURL == "" {
		return nil, fmt.Errorf("WEBHOOK_URL environment variable not set")
	}

	return &Config{
		APIKey:      apiKey,
		PhoneNumber: phoneNumber,
		WebhookURL:  webhookURL,
	}, nil
}

// NewTelnyxClient creates a new Telnyx client.
func NewTelnyxClient(apiKey string) *telnyx.Client {
	return telnyx.NewClient(option.WithAPIKey(apiKey))
}

// WebhookPayload represents the structure of a Telnyx webhook event.
type WebhookPayload struct {
	Data struct {
		ID         string `json:"id"`
		Type       string `json:"type"`
		Attributes struct {
			ID        string `json:"id"`
			Direction string `json:"direction"`
			From      struct {
				PhoneNumber string `json:"phone_number"`
			} `json:"from"`
			To []struct {
				PhoneNumber string `json:"phone_number"`
				Status      string `json:"status"`
			} `json:"to"`
			Text      string `json:"text"`
			CreatedAt string `json:"created_at"`
			UpdatedAt string `json:"updated_at"`
		} `json:"attributes"`
	} `json:"data"`
}

// MessageStatus represents a stored delivery receipt.
type MessageStatus struct {
	MessageID string `json:"message_id"`
	Direction string `json:"direction"`
	From      string `json:"from"`
	To        string `json:"to"`
	Status    string `json:"status"`
	Text      string `json:"text"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// MessageStore holds delivery receipts in memory.
type MessageStore struct {
	mu       sync.RWMutex
	messages map[string]*MessageStatus
}

// NewMessageStore creates a new message store.
func NewMessageStore() *MessageStore {
	return &MessageStore{
		messages: make(map[string]*MessageStatus),
	}
}

// Save stores a message status.
func (s *MessageStore) Save(status *MessageStatus) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.messages[status.MessageID] = status
}

// Get retrieves a message status by ID.
func (s *MessageStore) Get(messageID string) *MessageStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.messages[messageID]
}

// List returns all stored message statuses.
func (s *MessageStore) List() []*MessageStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()

	statuses := make([]*MessageStatus, 0, len(s.messages))
	for _, status := range s.messages {
		statuses = append(statuses, status)
	}
	return statuses
}

// Handlers holds handler methods for HTTP routes.
type Handlers struct {
	store  *MessageStore
	client *telnyx.Client
	config *Config
}

// NewHandlers creates a new handlers instance.
func NewHandlers(store *MessageStore, client *telnyx.Client, config *Config) *Handlers {
	return &Handlers{
		store:  store,
		client: client,
		config: config,
	}
}

// HandleWebhook processes incoming delivery receipt webhooks from Telnyx.
func (h *Handlers) HandleWebhook(c *gin.Context) {
	var payload WebhookPayload

	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	messageID := payload.Data.Attributes.ID
	direction := payload.Data.Attributes.Direction
	from := payload.Data.Attributes.From.PhoneNumber
	text := payload.Data.Attributes.Text
	createdAt := payload.Data.Attributes.CreatedAt
	updatedAt := payload.Data.Attributes.UpdatedAt

	var to string
	var status string
	if len(payload.Data.Attributes.To) > 0 {
		to = payload.Data.Attributes.To[0].PhoneNumber
		status = payload.Data.Attributes.To[0].Status
	}

	messageStatus := &MessageStatus{
		MessageID: messageID,
		Direction: direction,
		From:      from,
		To:        to,
		Status:    status,
		Text:      text,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}

	h.store.Save(messageStatus)

	c.JSON(http.StatusOK, gin.H{"status": "received"})
}

// HandleGetStatus retrieves the delivery status of a specific message.
func (h *Handlers) HandleGetStatus(c *gin.Context) {
	messageID := c.Param("message_id")

	if messageID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message_id parameter required"})
		return
	}

	status := h.store.Get(messageID)
	if status == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Message not found"})
		return
	}

	c.JSON(http.StatusOK, status)
}

// HandleListStatuses retrieves all stored delivery statuses.
func (h *Handlers) HandleListStatuses(c *gin.Context) {
	statuses := h.store.List()

	items := make([]map[string]interface{}, len(statuses))
	for i, status := range statuses {
		items[i] = map[string]interface{}{
			"message_id": status.MessageID,
			"direction":  status.Direction,
			"from":       status.From,
			"to":         status.To,
			"status":     status.Status,
			"text":       status.Text,
			"created_at": status.CreatedAt,
			"updated_at": status.UpdatedAt,
		}
	}

	c.JSON(http.StatusOK, items)
}

// HandleSendSMS sends an SMS and returns the message ID for tracking.
func (h *Handlers) HandleSendSMS(c *gin.Context) {
	var req struct {
		To      string `json:"to" binding:"required"`
		Message string `json:"message" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields: 'to' and 'message'"})
		return
	}

	if len(req.To) == 0 || req.To[0] != '+' {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number must be in E.164 format (e.g., +15551234567)"})
		return
	}

	response, err := h.client.Messages.Create(c.Request.Context(), &telnyx.MessageCreateParams{
		From: telnyx.String(h.config.PhoneNumber),
		To:   telnyx.String(req.To),
		Text: telnyx.String(req.Message),
	})

	if err != nil {
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
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send message"})
		}
		return
	}

	messageID := ""
	status := "unknown"
	if response.Data != nil {
		messageID = response.Data.ID
		if len(response.Data.To) > 0 {
			status = response.Data.To[0].Status
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message_id": messageID,
		"status":     status,
		"from":       h.config.PhoneNumber,
		"to":         req.To,
	})
}

func main() {
	config, err := LoadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	client := NewTelnyxClient(config.APIKey)
	store := NewMessageStore()
	handlers := NewHandlers(store, client, config)

	router := gin.Default()

	router.POST("/webhooks/message-status", handlers.HandleWebhook)
	router.GET("/messages/:message_id", handlers.HandleGetStatus)
	router.GET("/messages", handlers.HandleListStatuses)
	router.POST("/sms/send", handlers.HandleSendSMS)

	port := ":8080"
	fmt.Printf("Server running on http://localhost%s\n", port)
	if err := router.Run(port); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
