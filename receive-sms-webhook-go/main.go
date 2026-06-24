package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/option"
)

// WebhookPayload represents the structure of an inbound SMS webhook from Telnyx.
type WebhookPayload struct {
	Data struct {
		ID        string `json:"id"`
		Type      string `json:"type"`
		Direction string `json:"direction"`
		From      struct {
			PhoneNumber string `json:"phone_number"`
		} `json:"from"`
		To []struct {
			PhoneNumber string `json:"phone_number"`
		} `json:"to"`
		Text      string `json:"text"`
		Timestamp string `json:"received_at"`
	} `json:"data"`
}

// SMSMessage represents a processed inbound SMS for JSON response.
type SMSMessage struct {
	MessageID   string `json:"message_id"`
	From        string `json:"from"`
	To          string `json:"to"`
	Text        string `json:"text"`
	ReceivedAt  string `json:"received_at"`
	Direction   string `json:"direction"`
}

func init() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}
}

func main() {
	// Initialize Telnyx client with API key from environment
	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		log.Fatal("TELNYX_API_KEY environment variable not set")
	}

	client := telnyx.NewClient(option.WithAPIKey(apiKey))
	_ = client // Client initialized for future use (e.g., sending replies)

	// Initialize Gin router
	router := gin.Default()

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Webhook endpoint for inbound SMS
	router.POST("/webhooks/sms", handleSMSWebhook)

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting Gin server on port %s\n", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// handleSMSWebhook processes inbound SMS webhooks from Telnyx.
func handleSMSWebhook(c *gin.Context) {
	var payload WebhookPayload

	// Parse JSON request body
	if err := c.ShouldBindJSON(&payload); err != nil {
		log.Printf("Failed to parse webhook payload: %v\n", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	// Validate webhook contains message data
	if payload.Data.Type != "message.received" {
		log.Printf("Ignoring webhook event type: %s\n", payload.Data.Type)
		c.JSON(http.StatusOK, gin.H{"status": "ignored"})
		return
	}

	// Extract message details
	from := payload.Data.From.PhoneNumber
	to := ""
	if len(payload.Data.To) > 0 {
		to = payload.Data.To[0].PhoneNumber
	}
	text := payload.Data.Text
	timestamp := payload.Data.Timestamp

	// Log the inbound message
	log.Printf("Inbound SMS: From=%s, To=%s, Text=%s, Timestamp=%s\n", from, to, text, timestamp)

	// Build response object (JSON-serializable)
	message := SMSMessage{
		MessageID:  payload.Data.ID,
		From:       from,
		To:         to,
		Text:       text,
		ReceivedAt: timestamp,
		Direction:  payload.Data.Direction,
	}

	// Return 200 OK to acknowledge receipt
	c.JSON(http.StatusOK, gin.H{
		"status":  "received",
		"message": message,
	})
}
