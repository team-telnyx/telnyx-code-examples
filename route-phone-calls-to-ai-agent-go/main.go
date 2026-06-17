package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2"
)

// WebhookPayload represents the structure of a Telnyx webhook event.
type WebhookPayload struct {
	Data struct {
		EventType      string `json:"event_type"`
		CallControlID  string `json:"call_control_id"`
		From           string `json:"from"`
		To             string `json:"to"`
		State          string `json:"state"`
		Direction      string `json:"direction"`
		StartTime      string `json:"start_time"`
		AnswerTime     string `json:"answer_time"`
		EndTime        string `json:"end_time"`
		DisconnectCode string `json:"disconnect_code"`
	} `json:"data"`
}

func init() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}
}

func main() {
	// Initialize Telnyx client with API key from environment
	client := telnyx.NewClient(option.WithAPIKey(os.Getenv("TELNYX_API_KEY")))

	// Create Gin router
	router := gin.Default()

	// Middleware to log incoming requests
	router.Use(gin.Logger())

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Webhook endpoint for inbound call events
	router.POST("/webhooks/call", func(c *gin.Context) {
		handleCallWebhook(c, client)
	})

	// Start server on configured port
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting Gin server on port %s\n", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// handleCallWebhook processes inbound call events from Telnyx.
func handleCallWebhook(c *gin.Context, client *telnyx.Client) {
	var payload WebhookPayload

	// Parse JSON payload from webhook
	if err := c.ShouldBindJSON(&payload); err != nil {
		log.Printf("Invalid webhook payload: %v\n", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON payload"})
		return
	}

	eventType := payload.Data.EventType
	callControlID := payload.Data.CallControlID
	from := payload.Data.From
	to := payload.Data.To

	log.Printf("Received webhook: event_type=%s, call_control_id=%s, from=%s, to=%s\n",
		eventType, callControlID, from, to)

	// Handle different call lifecycle events
	switch eventType {
	case "call.initiated":
		handleCallInitiated(c, callControlID, from, to, client)

	case "call.answered":
		handleCallAnswered(c, callControlID, from, to)

	case "call.hangup":
		handleCallHangup(c, callControlID, payload.Data.DisconnectCode)

	case "call.dtmf.received":
		handleDTMFReceived(c, callControlID)

	default:
		log.Printf("Unhandled event type: %s\n", eventType)
		c.JSON(http.StatusOK, gin.H{"message": "Event received"})
	}
}

// handleCallInitiated processes the call.initiated event.
// This fires when an inbound call arrives at your Telnyx number.
func handleCallInitiated(c *gin.Context, callControlID, from, to string, client *telnyx.Client) {
	log.Printf("Call initiated from %s to %s\n", from, to)

	// Automatically answer the call
	// In production, you might add logic to screen calls, route to agents, etc.
	answerParams := &telnyx.CallAnswerParams{
		CallControlID: callControlID,
	}

	response, err := client.Calls.Answer(answerParams)
	if err != nil {
		log.Printf("Failed to answer call: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to answer call"})
		return
	}

	log.Printf("Call answered successfully: %+v\n", response)

	// Return 200 OK to acknowledge webhook receipt
	c.JSON(http.StatusOK, gin.H{
		"message":         "Call answered",
		"call_control_id": callControlID,
	})
}

// handleCallAnswered processes the call.answered event.
// This fires when the call is successfully connected.
func handleCallAnswered(c *gin.Context, callControlID, from, to string) {
	log.Printf("Call answered: from=%s, to=%s\n", from, to)

	// In production, you might:
	// - Start recording the call
	// - Play a greeting message
	// - Route to an IVR menu
	// - Log call metadata to a database

	c.JSON(http.StatusOK, gin.H{
		"message":         "Call answered event processed",
		"call_control_id": callControlID,
	})
}

// handleCallHangup processes the call.hangup event.
// This fires when either party disconnects.
func handleCallHangup(c *gin.Context, callControlID, disconnectCode string) {
	log.Printf("Call ended: call_control_id=%s, disconnect_code=%s\n", callControlID, disconnectCode)

	// In production, you might:
	// - Stop recording and save the file
	// - Update call duration in database
	// - Trigger post-call workflows (transcription, analysis, etc.)

	c.JSON(http.StatusOK, gin.H{
		"message":         "Call hangup event processed",
		"call_control_id": callControlID,
	})
}

// handleDTMFReceived processes DTMF (dial tone) events.
// This fires when the caller presses a digit during the call.
func handleDTMFReceived(c *gin.Context, callControlID string) {
	log.Printf("DTMF received on call: %s\n", callControlID)

	// In production, you might:
	// - Route based on digit pressed (IVR menu)
	// - Validate PIN entry
	// - Trigger actions based on user input

	c.JSON(http.StatusOK, gin.H{
		"message":         "DTMF event processed",
		"call_control_id": callControlID,
	})
}
