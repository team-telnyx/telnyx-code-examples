package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4"
	"github.com/team-telnyx/telnyx-go/v4/v2/client"
)

// WebhookPayload represents the structure of an inbound message webhook.
type WebhookPayload struct {
	Data struct {
		ID         string `json:"id"`
		Type       string `json:"type"`
		Direction  string `json:"direction"`
		From       string `json:"from"`
		To         string `json:"to"`
		Text       string `json:"text"`
		MediaURLs  []string `json:"media_urls"`
		ReceivedAt string `json:"received_at"`
	} `json:"data"`
}

// MessageResponse is the JSON-serializable response for received messages.
type MessageResponse struct {
	MessageID  string   `json:"message_id"`
	From       string   `json:"from"`
	To         string   `json:"to"`
	Text       string   `json:"text"`
	MediaURLs  []string `json:"media_urls"`
	ReceivedAt string   `json:"received_at"`
}

func init() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}
}

func main() {
	// Initialize Gin router
	router := gin.Default()

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Webhook endpoint for inbound messages
	router.POST("/webhooks/message", handleInboundMessage)

	// Global error handler for unhandled exceptions
	router.Use(errorHandler())

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting server on port %s\n", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// handleInboundMessage processes inbound MMS/SMS webhooks from Telnyx.
func handleInboundMessage(c *gin.Context) {
	var payload WebhookPayload

	// Parse JSON request body
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	// Validate webhook payload structure
	if payload.Data.ID == "" || payload.Data.Type == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields in webhook payload"})
		return
	}

	// Only process inbound messages
	if payload.Data.Direction != "inbound" {
		c.JSON(http.StatusOK, gin.H{"message": "Ignoring non-inbound message"})
		return
	}

	// Log the received message
	log.Printf("Received message ID: %s from %s to %s\n", payload.Data.ID, payload.Data.From, payload.Data.To)

	// If MMS (has media), log media URLs
	if len(payload.Data.MediaURLs) > 0 {
		log.Printf("MMS detected with %d media attachment(s)\n", len(payload.Data.MediaURLs))
		for i, url := range payload.Data.MediaURLs {
			log.Printf("  Media %d: %s\n", i+1, url)
		}
	}

	// Build response with extracted data
	response := MessageResponse{
		MessageID:  payload.Data.ID,
		From:       payload.Data.From,
		To:         payload.Data.To,
		Text:       payload.Data.Text,
		MediaURLs:  payload.Data.MediaURLs,
		ReceivedAt: payload.Data.ReceivedAt,
	}

	// Return 200 OK to acknowledge receipt (Telnyx expects this)
	c.JSON(http.StatusOK, response)
}

// errorHandler returns a Gin middleware for global error handling.
func errorHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		// Check if an error occurred during request processing
		if len(c.Errors) > 0 {
			err := c.Errors.Last().Err

			// Map Telnyx SDK errors to HTTP status codes
			switch err.(type) {
			case *telnyx.AuthenticationError:
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
			case *telnyx.RateLimitError:
				c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
			case *telnyx.APIStatusError:
				apiErr := err.(*telnyx.APIStatusError)
				c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error()})
			case *telnyx.APIConnectionError:
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
			}
		}
	}
}
