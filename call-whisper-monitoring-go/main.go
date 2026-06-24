package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4/v2"
	"github.com/team-telnyx/telnyx-go/v4/v2/call"
)

// Config holds environment configuration
type Config struct {
	APIKey       string
	PhoneNumber  string
	ConnectionID string
	WebhookURL   string
}

// CallMetadata tracks the state of a call through its lifecycle
type CallMetadata struct {
	CallControlID string
	ToNumber      string
	Status        string
	WhisperText   string
}

var (
	cfg    *Config
	client *telnyx.Client
	// In-memory store for call state (use a database in production)
	callState = make(map[string]CallMetadata)
	stateMu   sync.RWMutex
)

// LoadConfig loads and validates environment variables
func LoadConfig() (*Config, error) {
	// Load .env file if it exists (optional for production)
	_ = godotenv.Load()

	cfg := &Config{
		APIKey:       os.Getenv("TELNYX_API_KEY"),
		PhoneNumber:  os.Getenv("TELNYX_PHONE_NUMBER"),
		ConnectionID: os.Getenv("TELNYX_CONNECTION_ID"),
		WebhookURL:   os.Getenv("WEBHOOK_URL"),
	}

	// Validate required fields
	if cfg.APIKey == "" {
		return nil, fmt.Errorf("TELNYX_API_KEY environment variable not set")
	}
	if cfg.PhoneNumber == "" {
		return nil, fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}
	if cfg.ConnectionID == "" {
		return nil, fmt.Errorf("TELNYX_CONNECTION_ID environment variable not set")
	}

	return cfg, nil
}

func init() {
	var err error
	cfg, err = LoadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	// Initialize Telnyx client with API key
	client = telnyx.NewClient(telnyx.WithAPIKey(cfg.APIKey))
}

func main() {
	router := gin.Default()

	// Route to initiate a call with whisper prompt
	router.POST("/calls/initiate", initiateCallHandler)

	// Webhook endpoint to receive call events
	router.POST("/webhooks/call", callWebhookHandler)

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
		log.Fatalf("Server error: %v", err)
	}
}

// initiateCallHandler starts an outbound call with a whisper prompt
func initiateCallHandler(c *gin.Context) {
	var req struct {
		ToNumber    string `json:"to" binding:"required"`
		WhisperText string `json:"whisper_text" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields: 'to' and 'whisper_text'"})
		return
	}

	// Validate E.164 format
	if len(req.ToNumber) == 0 || req.ToNumber[0] != '+' {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number must be in E.164 format (e.g., +15551234567)"})
		return
	}

	callControlID, err := initiateCall(req.ToNumber, req.WhisperText)
	if err != nil {
		handleCallError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"call_control_id": callControlID,
		"to":              req.ToNumber,
		"status":          "initiated",
	})
}

// initiateCall creates an outbound call via Telnyx API
func initiateCall(toNumber, whisperText string) (string, error) {
	// Create call using the Telnyx SDK
	// Note: connection_id is REQUIRED and comes from your Call Control Application
	// call_control_id is RETURNED in the response, not passed as input
	dialResp, err := client.Calls.Dial(&call.DialRequest{
		From:         cfg.PhoneNumber,
		To:           toNumber,
		ConnectionID: cfg.ConnectionID,
	})

	if err != nil {
		return "", err
	}

	callControlID := dialResp.Data.CallControlID

	// Store call metadata for webhook processing
	stateMu.Lock()
	callState[callControlID] = CallMetadata{
		CallControlID: callControlID,
		ToNumber:      toNumber,
		Status:        "initiated",
		WhisperText:   whisperText,
	}
	stateMu.Unlock()

	log.Printf("Call initiated: %s to %s", callControlID, toNumber)
	return callControlID, nil
}

// callWebhookHandler processes incoming call events from Telnyx
func callWebhookHandler(c *gin.Context) {
	var event map[string]interface{}

	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	eventType, ok := event["data"].(map[string]interface{})
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid event structure"})
		return
	}

	callControlID, ok := eventType["call_control_id"].(string)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing call_control_id"})
		return
	}

	// Retrieve call metadata
	stateMu.RLock()
	metadata, exists := callState[callControlID]
	stateMu.RUnlock()

	if !exists {
		log.Printf("Received event for unknown call: %s", callControlID)
		c.JSON(http.StatusOK, gin.H{"status": "acknowledged"})
		return
	}

	// Extract event type from the webhook payload
	webhookEventType, ok := event["event_type"].(string)
	if !ok {
		c.JSON(http.StatusOK, gin.H{"status": "acknowledged"})
		return
	}

	log.Printf("Event %s for call %s", webhookEventType, callControlID)

	// Handle different call events
	switch webhookEventType {
	case "call.answered":
		// Call was answered by the recipient
		// Play the whisper prompt to the caller
		if err := playWhisperPrompt(callControlID, metadata.WhisperText); err != nil {
			log.Printf("Error playing whisper prompt: %v", err)
		}

	case "call.speak.ended":
		// Whisper prompt finished playing
		// Now bridge the call to the recipient
		if err := bridgeCall(callControlID); err != nil {
			log.Printf("Error bridging call: %v", err)
		}

	case "call.hangup":
		// Call ended, clean up state
		stateMu.Lock()
		delete(callState, callControlID)
		stateMu.Unlock()
		log.Printf("Call ended: %s", callControlID)

	default:
		log.Printf("Unhandled event type: %s", webhookEventType)
	}

	c.JSON(http.StatusOK, gin.H{"status": "acknowledged"})
}

// playWhisperPrompt uses text-to-speech to play a message to the caller
func playWhisperPrompt(callControlID, text string) error {
	// Use the Speak action to play TTS to the caller
	// This is a simplified example; in production, use proper SDK methods
	log.Printf("Playing whisper prompt to %s: %s", callControlID, text)
	// SDK method would be: client.Calls.Actions.Speak(callControlID, &speak.SpeakRequest{...})
	return nil
}

// bridgeCall connects the caller to the recipient (simulated)
func bridgeCall(callControlID string) error {
	log.Printf("Bridging call: %s", callControlID)
	// In a real scenario, this would use transfer or conference APIs
	return nil
}

// handleCallError maps Telnyx SDK errors to HTTP status codes
func handleCallError(c *gin.Context, err error) {
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}
