package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4"
)

// CallState tracks active calls and their transfer status.
type CallState struct {
	CallControlID string
	FromNumber    string
	ToNumber      string
	Status        string
	OriginalAgent string
	TransferAgent string
	mu            sync.RWMutex
}

// CallStore manages all active calls.
type CallStore struct {
	calls map[string]*CallState
	mu    sync.RWMutex
}

// NewCallStore creates a new call store.
func NewCallStore() *CallStore {
	return &CallStore{
		calls: make(map[string]*CallState),
	}
}

// Add stores a new call.
func (cs *CallStore) Add(callControlID string, state *CallState) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.calls[callControlID] = state
}

// Get retrieves a call by ID.
func (cs *CallStore) Get(callControlID string) *CallState {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	return cs.calls[callControlID]
}

// Update modifies an existing call.
func (cs *CallStore) Update(callControlID string, state *CallState) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.calls[callControlID] = state
}

// Delete removes a call.
func (cs *CallStore) Delete(callControlID string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	delete(cs.calls, callControlID)
}

// InitiateCallRequest represents the request to initiate a call.
type InitiateCallRequest struct {
	ToNumber string `json:"to" binding:"required"`
}

// TransferCallRequest represents the request to transfer a call.
type TransferCallRequest struct {
	CallControlID string `json:"call_control_id" binding:"required"`
	TransferTo    string `json:"transfer_to" binding:"required"`
}

// WebhookPayload represents the structure of incoming webhook events.
type WebhookPayload struct {
	Data struct {
		EventType     string `json:"event_type"`
		CallControlID string `json:"call_control_id"`
		From          string `json:"from"`
		To            string `json:"to"`
		State         string `json:"state"`
	} `json:"data"`
}

// CallHandlers holds dependencies for call operations.
type CallHandlers struct {
	Client    *telnyx.Client
	CallStore *CallStore
}

// NewCallHandlers creates a new CallHandlers instance.
func NewCallHandlers(client *telnyx.Client, callStore *CallStore) *CallHandlers {
	return &CallHandlers{
		Client:    client,
		CallStore: callStore,
	}
}

// InitiateCall handles outbound call initiation.
func (ch *CallHandlers) InitiateCall(c *gin.Context) {
	var req InitiateCallRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required field: 'to'"})
		return
	}

	fromNumber := os.Getenv("TELNYX_PHONE_NUMBER")
	connectionID := os.Getenv("TELNYX_CONNECTION_ID")

	if fromNumber == "" || connectionID == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Missing environment variables"})
		return
	}

	// Validate E.164 format.
	if req.ToNumber == "" || req.ToNumber[0] != '+' {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number must be in E.164 format"})
		return
	}

	// Initiate the call using the Telnyx SDK.
	response, err := ch.Client.Calls.Dial(&telnyx.CallDialRequest{
		From:         fromNumber,
		To:           req.ToNumber,
		ConnectionID: connectionID,
	})

	if err != nil {
		handleTelnyxError(c, err)
		return
	}

	// Store call state.
	callState := &CallState{
		CallControlID: response.Data.CallControlID,
		FromNumber:    fromNumber,
		ToNumber:      req.ToNumber,
		Status:        "active",
		OriginalAgent: fromNumber,
	}
	ch.CallStore.Add(response.Data.CallControlID, callState)

	c.JSON(http.StatusOK, gin.H{
		"call_control_id": response.Data.CallControlID,
		"from":            fromNumber,
		"to":              req.ToNumber,
		"status":          "initiated",
	})
}

// TransferCall handles warm transfer to another agent.
func (ch *CallHandlers) TransferCall(c *gin.Context) {
	var req TransferCallRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields: 'call_control_id', 'transfer_to'"})
		return
	}

	// Retrieve call state.
	callState := ch.CallStore.Get(req.CallControlID)
	if callState == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Call not found"})
		return
	}

	// Validate transfer target.
	if req.TransferTo == "" || req.TransferTo[0] != '+' {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Transfer target must be in E.164 format"})
		return
	}

	// Update call state to indicate transfer in progress.
	callState.Status = "transferring"
	callState.TransferAgent = req.TransferTo
	ch.CallStore.Update(req.CallControlID, callState)

	// Execute the transfer using the Telnyx SDK.
	_, err := ch.Client.Calls.Actions.Transfer(req.CallControlID, &telnyx.CallTransferRequest{
		To: req.TransferTo,
	})

	if err != nil {
		handleTelnyxError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"call_control_id": req.CallControlID,
		"status":          "transferred",
		"transfer_to":     req.TransferTo,
	})
}

// HandleWebhook processes incoming call control webhooks.
func (ch *CallHandlers) HandleWebhook(c *gin.Context) {
	var payload WebhookPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	callControlID := payload.Data.CallControlID
	eventType := payload.Data.EventType

	// Retrieve or initialize call state.
	callState := ch.CallStore.Get(callControlID)
	if callState == nil {
		callState = &CallState{
			CallControlID: callControlID,
			FromNumber:    payload.Data.From,
			ToNumber:      payload.Data.To,
			Status:        "active",
		}
	}

	// Update call state based on event type.
	switch eventType {
	case "call.initiated":
		callState.Status = "active"
	case "call.answered":
		callState.Status = "active"
	case "call.hangup":
		callState.Status = "ended"
		ch.CallStore.Delete(callControlID)
	case "call.transferred":
		callState.Status = "transferred"
	}

	ch.CallStore.Update(callControlID, callState)

	// Log the event for debugging.
	fmt.Printf("Webhook event: %s for call %s\n", eventType, callControlID)

	c.JSON(http.StatusOK, gin.H{"status": "received"})
}

// GetCallStatus retrieves the current status of a call.
func (ch *CallHandlers) GetCallStatus(c *gin.Context) {
	callControlID := c.Param("call_control_id")

	callState := ch.CallStore.Get(callControlID)
	if callState == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Call not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"call_control_id": callState.CallControlID,
		"from":            callState.FromNumber,
		"to":              callState.ToNumber,
		"status":          callState.Status,
		"original_agent":  callState.OriginalAgent,
		"transfer_agent":  callState.TransferAgent,
	})
}

// handleTelnyxError maps Telnyx SDK errors to HTTP status codes.
func handleTelnyxError(c *gin.Context, err error) {
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

func main() {
	// Load environment variables from .env file.
	godotenv.Load()

	// Initialize Telnyx client.
	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		panic("TELNYX_API_KEY environment variable not set")
	}

	client := telnyx.NewClient(telnyx.WithAPIKey(apiKey))

	// Initialize call store and handlers.
	callStore := NewCallStore()
	callHandlers := NewCallHandlers(client, callStore)

	// Set up Gin router.
	router := gin.Default()

	// Define routes.
	router.POST("/calls/initiate", callHandlers.InitiateCall)
	router.POST("/calls/transfer", callHandlers.TransferCall)
	router.POST("/webhooks/call-control", callHandlers.HandleWebhook)
	router.GET("/calls/:call_control_id/status", callHandlers.GetCallStatus)

	// Start server.
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	router.Run(":" + port)
}
