package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go/v2"
	"github.com/telnyx/telnyx-go/v2/call"
)

// Initialize Telnyx client at package level
var client *telnyx.Client

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

	client = telnyx.NewClient(telnyx.WithAPIKey(apiKey))
}

// InitiateCallRequest represents the JSON payload for initiating a call
type InitiateCallRequest struct {
	To  string `json:"to" binding:"required"`
	TTS string `json:"tts" binding:"required"`
}

// CallResponse represents the JSON response after initiating a call
type CallResponse struct {
	CallControlID string `json:"call_control_id"`
	From          string `json:"from"`
	To            string `json:"to"`
	Status        string `json:"status"`
}

// initiateCall creates an outbound call and returns the call control ID
func initiateCall(toNumber, ttsMessage string) (*CallResponse, error) {
	fromNumber := os.Getenv("TELNYX_PHONE_NUMBER")
	if fromNumber == "" {
		return nil, fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}

	connectionID := os.Getenv("TELNYX_CONNECTION_ID")
	if connectionID == "" {
		return nil, fmt.Errorf("TELNYX_CONNECTION_ID environment variable not set")
	}

	// Validate E.164 format to prevent API errors
	if toNumber == "" || toNumber[0] != '+' {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Initiate the call using the Telnyx SDK
	// Note: call_control_id is returned in the response, not passed as input
	response, err := client.Calls.Dial(&call.DialRequest{
		From:         fromNumber,
		To:           toNumber,
		ConnectionID: connectionID,
	})

	if err != nil {
		return nil, err
	}

	// Extract serializable data from SDK response
	return &CallResponse{
		CallControlID: response.Data.CallControlID,
		From:          fromNumber,
		To:            toNumber,
		Status:        "initiated",
	}, nil
}

// WebhookPayload represents the structure of incoming webhook events
type WebhookPayload struct {
	Data struct {
		CallControlID string `json:"call_control_id"`
		State         string `json:"state"`
		EventType     string `json:"event_type"`
	} `json:"data"`
}

// handleCallWebhook processes incoming call events and plays TTS when call is answered
func handleCallWebhook(c *gin.Context) {
	var payload WebhookPayload

	if err := c.BindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	callControlID := payload.Data.CallControlID
	eventType := payload.Data.EventType

	log.Printf("Received webhook event: %s for call: %s", eventType, callControlID)

	// When call is answered, play TTS message
	if eventType == "call.answered" {
		// In production, retrieve the TTS message from your database or cache
		// For this example, we use a default message
		ttsMessage := "Hello! This is a text to speech message from Telnyx."

		// Play TTS using the Telnyx SDK
		_, err := client.Calls.Speak(callControlID, &call.SpeakRequest{
			Payload:  ttsMessage,
			Voice:    "female",
			Language: "en-US",
		})

		if err != nil {
			log.Printf("Error playing TTS: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to play TTS"})
			return
		}

		log.Printf("TTS playback started for call: %s", callControlID)
	}

	// Acknowledge webhook receipt
	c.JSON(http.StatusOK, gin.H{"status": "received"})
}

func main() {
	router := gin.Default()

	// Route to initiate a call with TTS
	router.POST("/calls/tts", func(c *gin.Context) {
		var req InitiateCallRequest

		// Parse JSON request body
		if err := c.BindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields: 'to' and 'tts'"})
			return
		}

		// Call the helper function to initiate the call
		result, err := initiateCall(req.To, req.TTS)

		// Handle Telnyx SDK errors with appropriate HTTP status codes
		if err != nil {
			// Check for specific Telnyx error types
			if telnyxErr, ok := err.(*telnyx.APIError); ok {
				switch telnyxErr.Status {
				case http.StatusUnauthorized:
					c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
					return
				case http.StatusTooManyRequests:
					c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
					return
				default:
					c.JSON(telnyxErr.Status, gin.H{"error": err.Error(), "status_code": telnyxErr.Status})
					return
				}
			}

			// Handle validation errors
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Return successful response
		c.JSON(http.StatusOK, result)
	})

	// Webhook endpoint to receive call events
	router.POST("/webhooks/call", handleCallWebhook)

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	// Start the Gin server on port 8080
	log.Println("Starting Telnyx TTS server on :8080")
	if err := router.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
