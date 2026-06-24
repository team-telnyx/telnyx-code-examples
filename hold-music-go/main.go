package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4/v2/client"
)

var telnyxClient *client.Client

// CallWebhookPayload represents the structure of incoming call webhooks
type CallWebhookPayload struct {
	Data struct {
		EventType     string `json:"event_type"`
		CallControlID string `json:"call_control_id"`
		ConnectionID  string `json:"connection_id"`
		State         string `json:"state"`
		From          string `json:"from"`
		To            string `json:"to"`
		CallSessionID string `json:"call_session_id"`
	} `json:"data"`
}

func init() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}

	// Initialize Telnyx client with API key
	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		log.Fatal("TELNYX_API_KEY environment variable not set")
	}

	telnyxClient = client.NewClient(client.WithAPIKey(apiKey))
}

// answerCall answers an incoming call
func answerCall(callControlID string) error {
	params := &client.CallAnswerParams{
		CallControlId: callControlID,
	}

	_, err := telnyxClient.Calls.Answer(params)
	if err != nil {
		return err
	}

	log.Printf("Call %s answered successfully", callControlID)
	return nil
}

// playHoldMusic plays hold music audio to the caller
func playHoldMusic(callControlID string) error {
	holdMusicURL := os.Getenv("HOLD_MUSIC_URL")
	if holdMusicURL == "" {
		return nil // Skip if no hold music URL configured
	}

	params := &client.CallPlayParams{
		CallControlId: callControlID,
		AudioUrl:      holdMusicURL,
	}

	_, err := telnyxClient.Calls.Play(params)
	if err != nil {
		return err
	}

	log.Printf("Hold music started for call %s", callControlID)
	return nil
}

// handleCallWebhook processes incoming call events from Telnyx
func handleCallWebhook(c *gin.Context) {
	var payload CallWebhookPayload

	// Parse incoming webhook JSON
	if err := c.ShouldBindJSON(&payload); err != nil {
		log.Printf("Failed to parse webhook: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	eventType := payload.Data.EventType
	callControlID := payload.Data.CallControlID

	log.Printf("Received event: %s for call: %s", eventType, callControlID)

	// Handle different call events
	switch eventType {
	case "call.initiated":
		// Answer the incoming call
		if err := answerCall(callControlID); err != nil {
			log.Printf("Failed to answer call: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to answer call"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "call answered"})

	case "call.answered":
		// Play hold music after call is answered
		if err := playHoldMusic(callControlID); err != nil {
			log.Printf("Failed to play hold music: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to play hold music"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "hold music playing"})

	case "call.hangup":
		// Clean up resources when call ends
		log.Printf("Call %s ended", callControlID)
		c.JSON(http.StatusOK, gin.H{"status": "call ended"})

	default:
		log.Printf("Unhandled event type: %s", eventType)
		c.JSON(http.StatusOK, gin.H{"status": "event received"})
	}
}

func main() {
	router := gin.Default()

	// Webhook endpoint for receiving call events
	router.POST("/webhooks/call", handleCallWebhook)

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting server on port %s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
