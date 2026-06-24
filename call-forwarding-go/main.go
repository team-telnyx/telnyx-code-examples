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

// CallEvent represents the webhook payload from Telnyx.
type CallEvent struct {
	Data struct {
		EventType      string `json:"event_type"`
		CallControlID  string `json:"call_control_id"`
		ConnectionID   string `json:"connection_id"`
		From           string `json:"from"`
		To             string `json:"to"`
		State          string `json:"state"`
		CallSessionID  string `json:"call_session_id"`
	} `json:"data"`
}

// CallState tracks active calls for forwarding.
var callState = make(map[string]bool)

func init() {
	// Load environment variables from .env file.
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}
}

// answerCall answers an inbound call.
func answerCall(callControlID string) error {
	client := telnyx.NewClient(telnyx.WithAPIKey(os.Getenv("TELNYX_API_KEY")))
	
	params := &call.AnswerParams{}
	_, err := client.Calls.Answer(callControlID, params)
	if err != nil {
		return fmt.Errorf("failed to answer call: %w", err)
	}
	return nil
}

// transferCall transfers an active call to the forwarding destination.
func transferCall(callControlID, toNumber string) error {
	client := telnyx.NewClient(telnyx.WithAPIKey(os.Getenv("TELNYX_API_KEY")))
	
	params := &call.TransferParams{
		To: toNumber,
	}
	_, err := client.Calls.Transfer(callControlID, params)
	if err != nil {
		return fmt.Errorf("failed to transfer call: %w", err)
	}
	return nil
}

// hangupCall terminates a call.
func hangupCall(callControlID string) error {
	client := telnyx.NewClient(telnyx.WithAPIKey(os.Getenv("TELNYX_API_KEY")))
	
	params := &call.HangupParams{}
	_, err := client.Calls.Hangup(callControlID, params)
	if err != nil {
		return fmt.Errorf("failed to hangup call: %w", err)
	}
	return nil
}

// handleCallInitiated processes the call.initiated webhook event.
func handleCallInitiated(c *gin.Context, event *CallEvent) {
	callControlID := event.Data.CallControlID
	
	// Track this call as active.
	callState[callControlID] = true
	
	log.Printf("Inbound call initiated: %s from %s to %s", callControlID, event.Data.From, event.Data.To)
	
	// Answer the call.
	if err := answerCall(callControlID); err != nil {
		log.Printf("Error answering call %s: %v", callControlID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to answer call"})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{"status": "call answered"})
}

// handleCallAnswered processes the call.answered webhook event.
func handleCallAnswered(c *gin.Context, event *CallEvent) {
	callControlID := event.Data.CallControlID
	forwardTo := os.Getenv("FORWARD_TO_NUMBER")
	
	if forwardTo == "" {
		log.Printf("FORWARD_TO_NUMBER not configured")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Forwarding destination not configured"})
		return
	}
	
	log.Printf("Call answered: %s, transferring to %s", callControlID, forwardTo)
	
	// Transfer the call to the forwarding destination.
	if err := transferCall(callControlID, forwardTo); err != nil {
		log.Printf("Error transferring call %s: %v", callControlID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to transfer call"})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{"status": "call transferred"})
}

// handleCallHangup processes the call.hangup webhook event.
func handleCallHangup(c *gin.Context, event *CallEvent) {
	callControlID := event.Data.CallControlID
	
	// Clean up call state.
	delete(callState, callControlID)
	
	log.Printf("Call ended: %s (state: %s)", callControlID, event.Data.State)
	
	c.JSON(http.StatusOK, gin.H{"status": "call hangup processed"})
}

// webhookHandler processes incoming Telnyx webhook events.
func webhookHandler(c *gin.Context) {
	var event CallEvent
	
	// Parse the JSON payload.
	if err := c.BindJSON(&event); err != nil {
		log.Printf("Invalid webhook payload: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid payload"})
		return
	}
	
	eventType := event.Data.EventType
	log.Printf("Received webhook event: %s", eventType)
	
	// Route to appropriate handler based on event type.
	switch eventType {
	case "call.initiated":
		handleCallInitiated(c, &event)
	case "call.answered":
		handleCallAnswered(c, &event)
	case "call.hangup":
		handleCallHangup(c, &event)
	default:
		log.Printf("Unhandled event type: %s", eventType)
		c.JSON(http.StatusOK, gin.H{"status": "event received"})
	}
}

// healthCheck provides a simple health endpoint.
func healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "healthy"})
}

// getCallStatus returns the status of active calls.
func getCallStatus(c *gin.Context) {
	activeCount := len(callState)
	c.JSON(http.StatusOK, gin.H{
		"active_calls": activeCount,
		"forwarding_to": os.Getenv("FORWARD_TO_NUMBER"),
	})
}

func main() {
	// Initialize Gin router.
	router := gin.Default()
	
	// Register routes.
	router.GET("/health", healthCheck)
	router.POST("/webhooks/call", webhookHandler)
	router.GET("/status", getCallStatus)
	
	// Global error handler for Telnyx SDK exceptions.
	router.Use(func(c *gin.Context) {
		c.Next()
		
		// Check for errors set during request processing.
		if len(c.Errors) > 0 {
			err := c.Errors.Last()
			
			// Map Telnyx exceptions to HTTP status codes.
			switch err.Type {
			case gin.ErrorTypeBind:
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
			}
		}
	})
	
	// Start the server on port 8080.
	port := ":8080"
	log.Printf("Starting call forwarding server on %s", port)
	if err := router.Run(port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
