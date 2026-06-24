package main

import (
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2"
)

// Config holds application configuration
type Config struct {
	APIKey       string
	PhoneNumber  string
	ConnectionID string
	WebhookURL   string
}

// LoadConfig loads environment variables
func LoadConfig() *Config {
	godotenv.Load()
	return &Config{
		APIKey:       os.Getenv("TELNYX_API_KEY"),
		PhoneNumber:  os.Getenv("TELNYX_PHONE_NUMBER"),
		ConnectionID: os.Getenv("TELNYX_CONNECTION_ID"),
		WebhookURL:   os.Getenv("WEBHOOK_URL"),
	}
}

// WebhookEvent represents an incoming Telnyx webhook event
type WebhookEvent struct {
	Data struct {
		EventType     string `json:"event_type"`
		CallControlID string `json:"call_control_id"`
		State         string `json:"state"`
		From          string `json:"from"`
		To            string `json:"to"`
		DTMFDigits    string `json:"dtmf_digits"`
		RecordingURL  string `json:"recording_url"`
	} `json:"data"`
}

// CallState tracks active calls and their menu selections
type CallState struct {
	CallControlID string
	From          string
	To            string
	MenuLevel     int
	Selection     string
}

// In-memory store for active call states
var (
	callStates = make(map[string]*CallState)
	mu         sync.RWMutex
)

// HandleCallInitiated processes incoming calls
func HandleCallInitiated(c *gin.Context, client *telnyx.Client) {
	var event WebhookEvent
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	callControlID := event.Data.CallControlID
	from := event.Data.From
	to := event.Data.To

	// Store call state
	mu.Lock()
	callStates[callControlID] = &CallState{
		CallControlID: callControlID,
		From:          from,
		To:            to,
		MenuLevel:     0,
	}
	mu.Unlock()

	// Answer the call
	_, err := client.Calls.Actions.Answer(callControlID, nil)
	if err != nil {
		handleAPIError(c, err)
		return
	}

	// Play welcome message and present main menu
	playMainMenu(c, client, callControlID)
}

// HandleDTMFReceived processes DTMF input from the caller
func HandleDTMFReceived(c *gin.Context, client *telnyx.Client) {
	var event WebhookEvent
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	callControlID := event.Data.CallControlID
	digit := event.Data.DTMFDigits

	mu.RLock()
	state, exists := callStates[callControlID]
	mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Call state not found"})
		return
	}

	// Route based on menu level and digit selection
	switch state.MenuLevel {
	case 0: // Main menu
		handleMainMenuSelection(c, client, callControlID, digit, state)
	case 1: // Sales submenu
		handleSalesSubmenu(c, client, callControlID, digit, state)
	case 2: // Support submenu
		handleSupportSubmenu(c, client, callControlID, digit, state)
	default:
		c.JSON(http.StatusOK, gin.H{"status": "unknown_menu_level"})
	}
}

// HandleCallHangup cleans up call state when call ends
func HandleCallHangup(c *gin.Context) {
	var event WebhookEvent
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	callControlID := event.Data.CallControlID

	// Remove call state from memory
	mu.Lock()
	delete(callStates, callControlID)
	mu.Unlock()

	c.JSON(http.StatusOK, gin.H{"status": "call_ended"})
}

// playMainMenu plays the main menu prompt and waits for DTMF input
func playMainMenu(c *gin.Context, client *telnyx.Client, callControlID string) {
	prompt := "Welcome to our IVR system. Press 1 for Sales, 2 for Support, or 3 to repeat this menu."

	_, err := client.Calls.Actions.Speak(callControlID, &telnyx.CallSpeakRequest{
		Payload:  prompt,
		Voice:    "female",
		Language: "en-US",
	})
	if err != nil {
		handleAPIError(c, err)
		return
	}

	// Start gathering DTMF input
	_, err = client.Calls.Actions.GatherDTMF(callControlID, &telnyx.CallGatherDTMFRequest{
		MaxDigits:        1,
		TimeoutMillis:    5000,
		TerminatingDigit: "#",
	})
	if err != nil {
		handleAPIError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "menu_presented"})
}

// handleMainMenuSelection routes based on main menu digit
func handleMainMenuSelection(c *gin.Context, client *telnyx.Client, callControlID, digit string, state *CallState) {
	switch digit {
	case "1":
		// Route to Sales
		mu.Lock()
		state.MenuLevel = 1
		state.Selection = "sales"
		mu.Unlock()

		prompt := "You selected Sales. Press 1 for New Customers, 2 for Existing Customers, or 0 to return to main menu."
		speakAndGather(c, client, callControlID, prompt)

	case "2":
		// Route to Support
		mu.Lock()
		state.MenuLevel = 2
		state.Selection = "support"
		mu.Unlock()

		prompt := "You selected Support. Press 1 for Technical Support, 2 for Billing, or 0 to return to main menu."
		speakAndGather(c, client, callControlID, prompt)

	case "3":
		// Repeat main menu
		playMainMenu(c, client, callControlID)

	default:
		prompt := "Invalid selection. Please try again."
		speakAndGather(c, client, callControlID, prompt)
	}
}

// handleSalesSubmenu processes Sales menu selections
func handleSalesSubmenu(c *gin.Context, client *telnyx.Client, callControlID, digit string, state *CallState) {
	switch digit {
	case "1":
		// New Customers — transfer to sales agent
		transferCall(c, client, callControlID, "+15551234567", "New Customer Inquiry")

	case "2":
		// Existing Customers — transfer to account manager
		transferCall(c, client, callControlID, "+15559876543", "Existing Customer Support")

	case "0":
		// Return to main menu
		mu.Lock()
		state.MenuLevel = 0
		mu.Unlock()
		playMainMenu(c, client, callControlID)

	default:
		prompt := "Invalid selection. Press 1 for New Customers, 2 for Existing Customers, or 0 to return."
		speakAndGather(c, client, callControlID, prompt)
	}
}

// handleSupportSubmenu processes Support menu selections
func handleSupportSubmenu(c *gin.Context, client *telnyx.Client, callControlID, digit string, state *CallState) {
	switch digit {
	case "1":
		// Technical Support
		transferCall(c, client, callControlID, "+15551111111", "Technical Support Request")

	case "2":
		// Billing
		transferCall(c, client, callControlID, "+15552222222", "Billing Inquiry")

	case "0":
		// Return to main menu
		mu.Lock()
		state.MenuLevel = 0
		mu.Unlock()
		playMainMenu(c, client, callControlID)

	default:
		prompt := "Invalid selection. Press 1 for Technical Support, 2 for Billing, or 0 to return."
		speakAndGather(c, client, callControlID, prompt)
	}
}

// speakAndGather plays a prompt and waits for DTMF input
func speakAndGather(c *gin.Context, client *telnyx.Client, callControlID, prompt string) {
	_, err := client.Calls.Actions.Speak(callControlID, &telnyx.CallSpeakRequest{
		Payload:  prompt,
		Voice:    "female",
		Language: "en-US",
	})
	if err != nil {
		handleAPIError(c, err)
		return
	}

	_, err = client.Calls.Actions.GatherDTMF(callControlID, &telnyx.CallGatherDTMFRequest{
		MaxDigits:        1,
		TimeoutMillis:    5000,
		TerminatingDigit: "#",
	})
	if err != nil {
		handleAPIError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "gathering_input"})
}

// transferCall transfers the call to a destination number
func transferCall(c *gin.Context, client *telnyx.Client, callControlID, destination, reason string) {
	_, err := client.Calls.Actions.Transfer(callControlID, &telnyx.CallTransferRequest{
		To: destination,
	})
	if err != nil {
		handleAPIError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":      "call_transferred",
		"destination": destination,
		"reason":      reason,
	})
}

// handleAPIError maps Telnyx SDK errors to HTTP status codes
func handleAPIError(c *gin.Context, err error) {
	switch e := err.(type) {
	case *telnyx.AuthenticationError:
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
	case *telnyx.RateLimitError:
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
	case *telnyx.APIStatusError:
		c.JSON(e.StatusCode, gin.H{"error": e.Error()})
	case *telnyx.APIConnectionError:
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
	}
}

func main() {
	// Load configuration
	config := LoadConfig()

	// Validate required environment variables
	if config.APIKey == "" || config.PhoneNumber == "" || config.ConnectionID == "" {
		log.Fatal("Missing required environment variables: TELNYX_API_KEY, TELNYX_PHONE_NUMBER, TELNYX_CONNECTION_ID")
	}

	// Initialize Telnyx client
	client := telnyx.NewClient(option.WithAPIKey(config.APIKey))

	// Create Gin router
	router := gin.Default()

	// Webhook routes for call control events
	router.POST("/webhooks/call-initiated", func(c *gin.Context) {
		HandleCallInitiated(c, client)
	})

	router.POST("/webhooks/dtmf-received", func(c *gin.Context) {
		HandleDTMFReceived(c, client)
	})

	router.POST("/webhooks/call-hangup", func(c *gin.Context) {
		HandleCallHangup(c)
	})

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Start server on port 8080
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("IVR server listening on port %s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
