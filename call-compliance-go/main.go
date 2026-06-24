package main

import (
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4"
	"github.com/team-telnyx/telnyx-go/v4/option"
)

// Config holds application configuration
type Config struct {
	APIKey       string
	PhoneNumber  string
	ConnectionID string
	WebhookURL   string
	Port         string
}

// CallRecord represents a compliance-tracked call
type CallRecord struct {
	CallControlID string     `json:"call_control_id"`
	FromNumber    string     `json:"from_number"`
	ToNumber      string     `json:"to_number"`
	Status        string     `json:"status"`
	StartTime     time.Time  `json:"start_time"`
	EndTime       *time.Time `json:"end_time,omitempty"`
	Duration      int        `json:"duration_seconds,omitempty"`
	RecordingID   string     `json:"recording_id,omitempty"`
	IsRecorded    bool       `json:"is_recorded"`
	ComplianceLog string     `json:"compliance_log"`
}

// WebhookPayload represents incoming Telnyx webhook events
type WebhookPayload struct {
	Data struct {
		EventType     string `json:"event_type"`
		CallControlID string `json:"call_control_id"`
		From          string `json:"from"`
		To            string `json:"to"`
		State         string `json:"state"`
		RecordingID   string `json:"recording_id,omitempty"`
	} `json:"data"`
}

// InitiateCallRequest represents the request body for initiating a call
type InitiateCallRequest struct {
	ToNumber string `json:"to_number" binding:"required"`
}

var (
	config      Config
	client      *telnyx.Client
	callRecords = make(map[string]*CallRecord)
)

func init() {
	// Load environment variables from .env file
	_ = godotenv.Load()

	config = Config{
		APIKey:       os.Getenv("TELNYX_API_KEY"),
		PhoneNumber:  os.Getenv("TELNYX_PHONE_NUMBER"),
		ConnectionID: os.Getenv("TELNYX_CONNECTION_ID"),
		WebhookURL:   os.Getenv("WEBHOOK_URL"),
		Port:         getEnvOrDefault("PORT", "8080"),
	}

	// Validate required configuration
	if config.APIKey == "" {
		panic("TELNYX_API_KEY environment variable not set")
	}
	if config.PhoneNumber == "" {
		panic("TELNYX_PHONE_NUMBER environment variable not set")
	}
	if config.ConnectionID == "" {
		panic("TELNYX_CONNECTION_ID environment variable not set")
	}

	// Initialize Telnyx client with API key
	client = telnyx.NewClient(option.WithAPIKey(config.APIKey))
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// InitiateCall handles outbound call initiation with compliance tracking
func InitiateCall(c *gin.Context) {
	var req InitiateCallRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required field: to_number"})
		return
	}

	// Validate E.164 format
	if len(req.ToNumber) < 10 || req.ToNumber[0] != '+' {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number must be in E.164 format (e.g., +15551234567)"})
		return
	}

	// Initiate call via Telnyx API
	response, err := client.Calls.Dial(
		&telnyx.CallDialParams{
			From:         telnyx.String(config.PhoneNumber),
			To:           telnyx.String(req.ToNumber),
			ConnectionID: telnyx.String(config.ConnectionID),
		},
	)

	if err != nil {
		handleAPIError(c, err)
		return
	}

	// Extract call control ID from response
	callControlID := response.Data.CallControlID

	// Create compliance record
	record := &CallRecord{
		CallControlID: callControlID,
		FromNumber:    config.PhoneNumber,
		ToNumber:      req.ToNumber,
		Status:        "initiated",
		StartTime:     time.Now(),
		IsRecorded:    false,
		ComplianceLog: fmt.Sprintf("[%s] Call initiated from %s to %s", time.Now().Format(time.RFC3339), config.PhoneNumber, req.ToNumber),
	}

	callRecords[callControlID] = record

	c.JSON(http.StatusOK, gin.H{
		"call_control_id": callControlID,
		"from_number":     config.PhoneNumber,
		"to_number":       req.ToNumber,
		"status":          "initiated",
	})
}

// HandleWebhook processes incoming Telnyx call events
func HandleWebhook(c *gin.Context) {
	var payload WebhookPayload

	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	callControlID := payload.Data.CallControlID
	eventType := payload.Data.EventType

	// Retrieve or create call record
	record, exists := callRecords[callControlID]
	if !exists {
		record = &CallRecord{
			CallControlID: callControlID,
			FromNumber:    payload.Data.From,
			ToNumber:      payload.Data.To,
			Status:        "unknown",
			StartTime:     time.Now(),
			IsRecorded:    false,
			ComplianceLog: "",
		}
		callRecords[callControlID] = record
	}

	// Update record based on event type
	switch eventType {
	case "call.answered":
		record.Status = "answered"
		record.ComplianceLog += fmt.Sprintf("\n[%s] Call answered", time.Now().Format(time.RFC3339))

		// Automatically start recording for compliance
		_, err := client.Calls.Actions.StartRecording(
			callControlID,
			&telnyx.CallStartRecordingParams{
				Format: telnyx.String("wav"),
			},
		)
		if err != nil {
			record.ComplianceLog += fmt.Sprintf("\n[%s] Recording start failed: %v", time.Now().Format(time.RFC3339), err)
		} else {
			record.IsRecorded = true
			record.ComplianceLog += fmt.Sprintf("\n[%s] Recording started", time.Now().Format(time.RFC3339))
		}

	case "call.hangup":
		record.Status = "completed"
		now := time.Now()
		record.EndTime = &now
		record.Duration = int(now.Sub(record.StartTime).Seconds())
		record.ComplianceLog += fmt.Sprintf("\n[%s] Call ended (duration: %d seconds)", now.Format(time.RFC3339), record.Duration)

		// Stop recording if active
		if record.IsRecorded {
			_, err := client.Calls.Actions.StopRecording(callControlID, &telnyx.CallStopRecordingParams{})
			if err != nil {
				record.ComplianceLog += fmt.Sprintf("\n[%s] Recording stop failed: %v", time.Now().Format(time.RFC3339), err)
			} else {
				record.ComplianceLog += fmt.Sprintf("\n[%s] Recording stopped", time.Now().Format(time.RFC3339))
			}
		}

	case "call.recording.saved":
		record.RecordingID = payload.Data.RecordingID
		record.ComplianceLog += fmt.Sprintf("\n[%s] Recording saved with ID: %s", time.Now().Format(time.RFC3339), payload.Data.RecordingID)

	default:
		record.ComplianceLog += fmt.Sprintf("\n[%s] Event received: %s", time.Now().Format(time.RFC3339), eventType)
	}

	c.JSON(http.StatusOK, gin.H{"status": "received"})
}

// GetCallStatus retrieves the compliance record for a call
func GetCallStatus(c *gin.Context) {
	callControlID := c.Param("call_control_id")

	record, exists := callRecords[callControlID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Call record not found"})
		return
	}

	c.JSON(http.StatusOK, record)
}

// ListCallRecords returns all compliance records
func ListCallRecords(c *gin.Context) {
	records := make([]map[string]interface{}, 0)

	for _, record := range callRecords {
		records = append(records, map[string]interface{}{
			"call_control_id": record.CallControlID,
			"from_number":     record.FromNumber,
			"to_number":       record.ToNumber,
			"status":          record.Status,
			"start_time":      record.StartTime,
			"end_time":        record.EndTime,
			"duration":        record.Duration,
			"is_recorded":     record.IsRecorded,
			"recording_id":    record.RecordingID,
		})
	}

	c.JSON(http.StatusOK, gin.H{"records": records})
}

// handleAPIError maps Telnyx SDK errors to HTTP status codes
func handleAPIError(c *gin.Context, err error) {
	switch err.(type) {
	case *telnyx.AuthenticationError:
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
	case *telnyx.RateLimitError:
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
	case *telnyx.APIConnectionError:
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
	case *telnyx.APIStatusError:
		statusErr := err.(*telnyx.APIStatusError)
		c.JSON(statusErr.StatusCode, gin.H{"error": statusErr.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
	}
}

func main() {
	// Create Gin router
	router := gin.Default()

	// Define routes
	router.POST("/calls/initiate", InitiateCall)
	router.POST("/webhooks/call", HandleWebhook)
	router.GET("/calls/:call_control_id", GetCallStatus)
	router.GET("/calls", ListCallRecords)

	// Start server
	router.Run(":" + config.Port)
}
