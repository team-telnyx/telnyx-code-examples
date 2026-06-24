package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2"
)

// InitiateCallRequest represents the JSON payload for initiating a call.
type InitiateCallRequest struct {
	To string `json:"to" binding:"required"`
}

// CallResponse represents the JSON response after initiating a call.
type CallResponse struct {
	CallControlID string `json:"call_control_id"`
	From          string `json:"from"`
	To            string `json:"to"`
	Status        string `json:"status"`
}

// initiateCall handles the business logic for starting an outbound call.
// It validates the destination number and uses the Telnyx API to dial.
func initiateCall(toNumber string) (*CallResponse, error) {
	fromNumber := os.Getenv("TELNYX_PHONE_NUMBER")
	if fromNumber == "" {
		return nil, fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}

	connectionID := os.Getenv("TELNYX_CONNECTION_ID")
	if connectionID == "" {
		return nil, fmt.Errorf("TELNYX_CONNECTION_ID environment variable not set")
	}

	// Validate E.164 format to prevent API errors.
	if !strings.HasPrefix(toNumber, "+") {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Initialize the Telnyx client with API key from environment.
	client := telnyx.NewClient(option.WithAPIKey(os.Getenv("TELNYX_API_KEY")))

	// Dial the call using the Call Control API.
	// connection_id is the Call Control Application ID (static config).
	// call_control_id is returned in the response and used for subsequent actions.
	response, err := client.Calls.Dial(
		&v2.CallDialRequest{
			From:         fromNumber,
			To:           toNumber,
			ConnectionID: connectionID,
		},
	)
	if err != nil {
		return nil, err
	}

	// Extract serializable data from the SDK response.
	return &CallResponse{
		CallControlID: response.Data.CallControlID,
		From:          fromNumber,
		To:            toNumber,
		Status:        "initiated",
	}, nil
}

func main() {
	// Load environment variables from .env file.
	godotenv.Load()

	// Create a new Gin router.
	router := gin.Default()

	// POST /calls/dial — initiate an outbound call.
	router.POST("/calls/dial", func(c *gin.Context) {
		var req InitiateCallRequest

		// Bind and validate JSON request body.
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Missing required field: 'to'",
			})
			return
		}

		// Call the helper function to initiate the call.
		result, err := initiateCall(req.To)

		// Handle Telnyx SDK errors with appropriate HTTP status codes.
		if err != nil {
			// Check for specific Telnyx error types.
			if _, ok := err.(*telnyx.AuthenticationError); ok {
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Invalid API key",
				})
				return
			}
			if _, ok := err.(*telnyx.RateLimitError); ok {
				c.JSON(http.StatusTooManyRequests, gin.H{
					"error": "Rate limit exceeded. Please slow down.",
				})
				return
			}
			if apiErr, ok := err.(*telnyx.APIStatusError); ok {
				c.JSON(apiErr.StatusCode, gin.H{
					"error":       apiErr.Error(),
					"status_code": apiErr.StatusCode,
				})
				return
			}
			if _, ok := err.(*telnyx.APIConnectionError); ok {
				c.JSON(http.StatusServiceUnavailable, gin.H{
					"error": "Network error connecting to Telnyx",
				})
				return
			}

			// Handle validation errors (E.164 format, missing env vars).
			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
			})
			return
		}

		// Return the call control ID and metadata on success.
		c.JSON(http.StatusOK, result)
	})

	// Start the Gin server on port 8080.
	router.Run(":8080")
}
