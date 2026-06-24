package main

import (
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4/v2"
	"github.com/team-telnyx/telnyx-go/v4/v2/option"
)

// Config holds application configuration from environment variables.
type Config struct {
	APIKey       string
	PhoneNumber  string
	ConnectionID string
	WebhookURL   string
	Port         string
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() *Config {
	_ = godotenv.Load()
	return &Config{
		APIKey:       os.Getenv("TELNYX_API_KEY"),
		PhoneNumber:  os.Getenv("TELNYX_PHONE_NUMBER"),
		ConnectionID: os.Getenv("TELNYX_CONNECTION_ID"),
		WebhookURL:   os.Getenv("WEBHOOK_URL"),
		Port:         getEnvOrDefault("PORT", "8080"),
	}
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// CallRecord represents a single call in our analytics system.
type CallRecord struct {
	CallControlID string     `json:"call_control_id"`
	FromNumber    string     `json:"from_number"`
	ToNumber      string     `json:"to_number"`
	Status        string     `json:"status"`
	StartTime     time.Time  `json:"start_time"`
	EndTime       *time.Time `json:"end_time,omitempty"`
	Duration      int        `json:"duration_seconds"`
	RecordingURL  string     `json:"recording_url,omitempty"`
}

// WebhookPayload represents the structure of Telnyx webhook events.
type WebhookPayload struct {
	Data struct {
		EventType     string `json:"event_type"`
		CallControlID string `json:"call_control_id"`
		From          string `json:"from"`
		To            string `json:"to"`
		State         string `json:"state"`
		RecordingURLs []struct {
			URL string `json:"url"`
		} `json:"recording_urls"`
	} `json:"data"`
}

// CallAnalytics represents aggregated call metrics.
type CallAnalytics struct {
	TotalCalls      int     `json:"total_calls"`
	CompletedCalls  int     `json:"completed_calls"`
	FailedCalls     int     `json:"failed_calls"`
	AverageDuration float64 `json:"average_duration_seconds"`
	RecordedCalls   int     `json:"recorded_calls"`
}

// InitiateCallRequest represents the JSON payload for initiating a call.
type InitiateCallRequest struct {
	ToNumber string `json:"to_number" binding:"required"`
}

// CallStore manages call records with thread-safe operations.
type CallStore struct {
	mu    sync.RWMutex
	calls map[string]*CallRecord
}

// NewCallStore creates a new call store.
func NewCallStore() *CallStore {
	return &CallStore{
		calls: make(map[string]*CallRecord),
	}
}

// Create adds a new call record to the store.
func (cs *CallStore) Create(callControlID, fromNumber, toNumber string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	cs.calls[callControlID] = &CallRecord{
		CallControlID: callControlID,
		FromNumber:    fromNumber,
		ToNumber:      toNumber,
		Status:        "initiated",
		StartTime:     time.Now(),
		Duration:      0,
	}
}

// Update modifies the status of an existing call record.
func (cs *CallStore) Update(callControlID, status string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	if call, exists := cs.calls[callControlID]; exists {
		call.Status = status
		if status == "completed" || status == "failed" {
			now := time.Now()
			call.EndTime = &now
			call.Duration = int(now.Sub(call.StartTime).Seconds())
		}
	}
}

// AddRecording associates a recording URL with a call.
func (cs *CallStore) AddRecording(callControlID, recordingURL string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()

	if call, exists := cs.calls[callControlID]; exists {
		call.RecordingURL = recordingURL
	}
}

// Get retrieves a single call record by ID.
func (cs *CallStore) Get(callControlID string) *CallRecord {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	return cs.calls[callControlID]
}

// GetAll retrieves all call records.
func (cs *CallStore) GetAll() []*CallRecord {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	records := make([]*CallRecord, 0, len(cs.calls))
	for _, call := range cs.calls {
		records = append(records, call)
	}
	return records
}

// GetAnalytics computes aggregated call metrics.
func (cs *CallStore) GetAnalytics() *CallAnalytics {
	cs.mu.RLock()
	defer cs.mu.RUnlock()

	analytics := &CallAnalytics{}
	var totalDuration int

	for _, call := range cs.calls {
		analytics.TotalCalls++
		if call.Status == "completed" {
			analytics.CompletedCalls++
			totalDuration += call.Duration
		} else if call.Status == "failed" {
			analytics.FailedCalls++
		}
		if call.RecordingURL != "" {
			analytics.RecordedCalls++
		}
	}

	if analytics.CompletedCalls > 0 {
		analytics.AverageDuration = float64(totalDuration) / float64(analytics.CompletedCalls)
	}

	return analytics
}

// InitiateCallHandler starts an outbound call and records it in the store.
func InitiateCallHandler(client *telnyx.Client, store *CallStore, config *Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req InitiateCallRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required field: to_number"})
			return
		}

		// Validate E.164 format
		if len(req.ToNumber) == 0 || req.ToNumber[0] != '+' {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number must be in E.164 format (e.g., +15551234567)"})
			return
		}

		// Initiate the call via Telnyx API
		response, err := client.Calls.Dial(&telnyx.CallDialRequest{
			From:         config.PhoneNumber,
			To:           req.ToNumber,
			ConnectionID: config.ConnectionID,
		})

		// Handle Telnyx API errors
		if err != nil {
			switch err.(type) {
			case *telnyx.AuthenticationError:
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
			case *telnyx.RateLimitError:
				c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
			case *telnyx.APIStatusError:
				statusErr := err.(*telnyx.APIStatusError)
				c.JSON(statusErr.StatusCode, gin.H{"error": err.Error(), "status_code": statusErr.StatusCode})
			case *telnyx.APIConnectionError:
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to initiate call"})
			}
			return
		}

		// Extract call control ID from response and store the call record
		callControlID := response.Data.CallControlID
		store.Create(callControlID, config.PhoneNumber, req.ToNumber)

		c.JSON(http.StatusOK, gin.H{
			"call_control_id": callControlID,
			"from_number":     config.PhoneNumber,
			"to_number":       req.ToNumber,
			"status":          "initiated",
		})
	}
}

// WebhookHandler processes incoming Telnyx call events.
func WebhookHandler(store *CallStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var payload WebhookPayload
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
			return
		}

		callControlID := payload.Data.CallControlID
		eventType := payload.Data.EventType

		// Update call status based on event type
		switch eventType {
		case "call.initiated":
			store.Update(callControlID, "initiated")
		case "call.answered":
			store.Update(callControlID, "answered")
		case "call.hangup":
			store.Update(callControlID, "completed")
		case "call.recording.saved":
			if len(payload.Data.RecordingURLs) > 0 {
				store.AddRecording(callControlID, payload.Data.RecordingURLs[0].URL)
			}
		}

		c.JSON(http.StatusOK, gin.H{"status": "received"})
	}
}

// GetCallStatusHandler retrieves the status of a specific call.
func GetCallStatusHandler(store *CallStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		callControlID := c.Param("call_control_id")
		call := store.Get(callControlID)

		if call == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Call not found"})
			return
		}

		c.JSON(http.StatusOK, call)
	}
}

// GetCallsHandler retrieves all recorded calls.
func GetCallsHandler(store *CallStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		calls := store.GetAll()
		c.JSON(http.StatusOK, calls)
	}
}

// GetAnalyticsHandler returns aggregated call analytics.
func GetAnalyticsHandler(store *CallStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		analytics := store.GetAnalytics()
		c.JSON(http.StatusOK, analytics)
	}
}

func main() {
	// Load configuration from environment
	config := LoadConfig()

	// Validate required environment variables
	if config.APIKey == "" || config.PhoneNumber == "" || config.ConnectionID == "" {
		log.Fatal("Missing required environment variables: TELNYX_API_KEY, TELNYX_PHONE_NUMBER, TELNYX_CONNECTION_ID")
	}

	// Initialize Telnyx client with API key
	client := telnyx.NewClient(option.WithAPIKey(config.APIKey))

	// Initialize in-memory call store
	store := NewCallStore()

	// Create Gin router
	router := gin.Default()

	// Define routes
	router.POST("/calls/initiate", InitiateCallHandler(client, store, config))
	router.POST("/webhooks/call", WebhookHandler(store))
	router.GET("/calls/:call_control_id", GetCallStatusHandler(store))
	router.GET("/calls", GetCallsHandler(store))
	router.GET("/analytics", GetAnalyticsHandler(store))

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Start server
	log.Printf("Starting server on port %s\n", config.Port)
	if err := router.Run(":" + config.Port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
