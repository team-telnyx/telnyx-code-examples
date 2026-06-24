package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4/v2"
	"github.com/team-telnyx/telnyx-go/v4/v2/messaging"
)

// Config holds application configuration.
type Config struct {
	TelnyxAPIKey   string
	TelnyxPhoneNum string
	Port           string
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() (*Config, error) {
	_ = godotenv.Load()

	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("TELNYX_API_KEY environment variable not set")
	}

	phoneNum := os.Getenv("TELNYX_PHONE_NUMBER")
	if phoneNum == "" {
		return nil, fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	return &Config{
		TelnyxAPIKey:   apiKey,
		TelnyxPhoneNum: phoneNum,
		Port:           port,
	}, nil
}

// NotificationRequest represents an incoming SMS notification request.
type NotificationRequest struct {
	To       string `json:"to" binding:"required"`
	Message  string `json:"message" binding:"required"`
	MediaURL string `json:"media_url"`
}

// NotificationResponse represents the response after sending a notification.
type NotificationResponse struct {
	MessageID string `json:"message_id"`
	Status    string `json:"status"`
	From      string `json:"from"`
	To        string `json:"to"`
}

// NotificationService handles SMS sending logic.
type NotificationService struct {
	client     *telnyx.Client
	fromNumber string
}

// NewNotificationService creates a new notification service instance.
func NewNotificationService(apiKey, fromNumber string) *NotificationService {
	client := telnyx.NewClient(telnyx.WithAPIKey(apiKey))
	return &NotificationService{
		client:     client,
		fromNumber: fromNumber,
	}
}

// SendNotification sends an SMS notification and returns the response.
func (ns *NotificationService) SendNotification(req *NotificationRequest) (*NotificationResponse, error) {
	// Validate E.164 format to prevent API errors.
	if len(req.To) == 0 || req.To[0] != '+' {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Build the message creation request.
	createReq := &messaging.CreateMessageRequest{
		From: ns.fromNumber,
		To:   req.To,
		Text: req.Message,
	}

	// Add media URLs if provided (for MMS).
	if req.MediaURL != "" {
		createReq.MediaURLs = []string{req.MediaURL}
	}

	// Send the message via Telnyx API.
	response, err := ns.client.Messaging.CreateMessage(createReq)
	if err != nil {
		return nil, err
	}

	// Extract serializable data from the response.
	status := "unknown"
	if response.Data != nil && len(response.Data.To) > 0 {
		status = response.Data.To[0].Status
	}

	return &NotificationResponse{
		MessageID: response.Data.ID,
		Status:    status,
		From:      ns.fromNumber,
		To:        req.To,
	}, nil
}

func main() {
	// Load configuration from environment.
	config, err := LoadConfig()
	if err != nil {
		panic(err)
	}

	// Initialize the notification service.
	notificationService := NewNotificationService(config.TelnyxAPIKey, config.TelnyxPhoneNum)

	// Create Gin router.
	router := gin.Default()

	// Register routes.
	router.POST("/notifications/send", func(c *gin.Context) {
		sendNotificationHandler(c, notificationService)
	})

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	// Start the server.
	router.Run(":" + config.Port)
}

// sendNotificationHandler handles incoming SMS notification requests.
func sendNotificationHandler(c *gin.Context, service *NotificationService) {
	var req NotificationRequest

	// Parse and validate the JSON request body.
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	// Send the notification.
	response, err := service.SendNotification(&req)

	// Handle Telnyx API errors with appropriate HTTP status codes.
	if err != nil {
		switch err.(type) {
		case *telnyx.AuthenticationError:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
		case *telnyx.RateLimitError:
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
		case *telnyx.APIStatusError:
			apiErr := err.(*telnyx.APIStatusError)
			c.JSON(apiErr.StatusCode, gin.H{"error": err.Error(), "status_code": apiErr.StatusCode})
		case *telnyx.APIConnectionError:
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
		default:
			// Handle validation errors and other issues.
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}

	// Return the successful response.
	c.JSON(http.StatusOK, response)
}
