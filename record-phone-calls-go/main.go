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

	// Initialize Telnyx client with API key from environment
	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		log.Fatal("TELNYX_API_KEY environment variable not set")
	}

	client = telnyx.NewClient(telnyx.WithAPIKey(apiKey))
}

// CallInitiateRequest represents the JSON payload for initiating a call
type CallInitiateRequest struct {
	To string `json:"to" binding:"required"`
}

// CallInitiateResponse represents the JSON response after initiating a call
type CallInitiateResponse struct {
	CallControlID string `json:"call_control_id"`
	From          string `json:"from"`
	To            string `json:"to"`
	Status        string `json:"status"`
}

// WebhookPayload represents the structure of Telnyx webhook events
type WebhookPayload struct {
	Data struct {
		EventType     string `json:"event_type"`
		CallControlID string `json:"call_control_id"`
		State         string `json:"state"`
		RecordingID   string `json:"recording_id"`
	} `json:"data"`
}

// initiateCall creates an outbound call with recording capability
func initiateCall(toNumber string) (*CallInitiateResponse, error) {
	fromNumber := os.Getenv("TELNYX_PHONE_NUMBER")
	if fromNumber == "" {
		return nil, fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}

	connectionID := os.Getenv("TELNYX_CONNECTION_ID")
	if connectionID == "" {
		return nil, fmt.Errorf("TELNYX_CONNECTION_ID environment variable not set")
	}

	// Validate E.164 format to prevent API errors
	if len(toNumber) == 0 || toNumber[0] != '+' {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Create call with recording enabled
	dialParams := &call.DialParams{
		From:         fromNumber,
		To:           toNumber,
		ConnectionID: connectionID,
	}

	response, err := client.Calls.Dial(dialParams)
	if err != nil {
		return nil, err
	}

	// Extract serializable data — SDK objects are NOT JSON-serializable
	return &CallInitiateResponse{
		CallControlID: response.Data.CallControlID,
		From:          fromNumber,
		To:            toNumber,
		Status:        "initiated",
	}, nil
}

// startRecording begins recording an active call
func startRecording(callControlID string) error {
	if callControlID == "" {
		return fmt.Errorf("call_control_id is required")
	}

	recordParams := &call.StartRecordingParams{
		Format: "wav",
	}

	_, err := client.Calls.StartRecording(callControlID, recordParams)
	return err
}

// stopRecording ends recording for an active call
func stopRecording(callControlID string) error {
	if callControlID == "" {
		return fmt.Errorf("call_control_id is required")
	}

	_, err := client.Calls.StopRecording(callControlID)
	return err
}

func main() {
	router := gin.Default()

	// POST /calls/initiate — Initiate an outbound call with recording capability
	router.POST("/calls/initiate", func(c *gin.Context) {
		var req CallInitiateRequest

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Missing required field: 'to'",
			})
			return
		}

		result, err := initiateCall(req.To)
		if err != nil {
			// Handle Telnyx SDK errors
			if _, ok := err.(telnyx.AuthenticationError); ok {
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Invalid API key",
				})
				return
			}
			if _, ok := err.(telnyx.RateLimitError); ok {
				c.JSON(http.StatusTooManyRequests, gin.H{
					"error": "Rate limit exceeded. Please slow down.",
				})
				return
			}
			if apiErr, ok := err.(telnyx.APIStatusError); ok {
				c.JSON(apiErr.StatusCode, gin.H{
					"error":       apiErr.Error(),
					"status_code": apiErr.StatusCode,
				})
				return
			}
			if _, ok := err.(telnyx.APIConnectionError); ok {
				c.JSON(http.StatusServiceUnavailable, gin.H{
					"error": "Network error connecting to Telnyx",
				})
				return
			}

			// Handle validation errors
			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, result)
	})

	// POST /calls/:call_control_id/recording/start — Start recording an active call
	router.POST("/calls/:call_control_id/recording/start", func(c *gin.Context) {
		callControlID := c.Param("call_control_id")

		if callControlID == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "call_control_id is required",
			})
			return
		}

		err := startRecording(callControlID)
		if err != nil {
			// Handle Telnyx SDK errors
			if _, ok := err.(telnyx.AuthenticationError); ok {
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Invalid API key",
				})
				return
			}
			if _, ok := err.(telnyx.RateLimitError); ok {
				c.JSON(http.StatusTooManyRequests, gin.H{
					"error": "Rate limit exceeded. Please slow down.",
				})
				return
			}
			if apiErr, ok := err.(telnyx.APIStatusError); ok {
				c.JSON(apiErr.StatusCode, gin.H{
					"error":       apiErr.Error(),
					"status_code": apiErr.StatusCode,
				})
				return
			}
			if _, ok := err.(telnyx.APIConnectionError); ok {
				c.JSON(http.StatusServiceUnavailable, gin.H{
					"error": "Network error connecting to Telnyx",
				})
				return
			}

			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"call_control_id": callControlID,
			"status":          "recording_started",
		})
	})

	// POST /calls/:call_control_id/recording/stop — Stop recording an active call
	router.POST("/calls/:call_control_id/recording/stop", func(c *gin.Context) {
		callControlID := c.Param("call_control_id")

		if callControlID == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "call_control_id is required",
			})
			return
		}

		err := stopRecording(callControlID)
		if err != nil {
			// Handle Telnyx SDK errors
			if _, ok := err.(telnyx.AuthenticationError); ok {
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Invalid API key",
				})
				return
			}
			if _, ok := err.(telnyx.RateLimitError); ok {
				c.JSON(http.StatusTooManyRequests, gin.H{
					"error": "Rate limit exceeded. Please slow down.",
				})
				return
			}
			if apiErr, ok := err.(telnyx.APIStatusError); ok {
				c.JSON(apiErr.StatusCode, gin.H{
					"error":       apiErr.Error(),
					"status_code": apiErr.StatusCode,
				})
				return
			}
			if _, ok := err.(telnyx.APIConnectionError); ok {
				c.JSON(http.StatusServiceUnavailable, gin.H{
					"error": "Network error connecting to Telnyx",
				})
				return
			}

			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"call_control_id": callControlID,
			"status":          "recording_stopped",
		})
	})

	// POST /webhooks/call-events — Receive Telnyx webhook events for recording lifecycle
	router.POST("/webhooks/call-events", func(c *gin.Context) {
		var payload WebhookPayload

		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid webhook payload",
			})
			return
		}

		// Log webhook event for debugging and monitoring
		log.Printf("Webhook event: %s for call %s\n",
			payload.Data.EventType,
			payload.Data.CallControlID)

		// Handle recording.saved event — recording is ready for download
		if payload.Data.EventType == "call.recording.saved" {
			log.Printf("Recording saved: %s\n", payload.Data.RecordingID)
		}

		// Acknowledge webhook receipt to Telnyx
		c.JSON(http.StatusOK, gin.H{
			"status": "received",
		})
	})

	// GET /health — Health check endpoint for monitoring
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "healthy",
		})
	})

	// Start the server on port 8080
	if err := router.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
