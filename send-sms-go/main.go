package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go/v2"
	"github.com/telnyx/telnyx-go/v2/messaging"
)

// Initialize client with the new SDK pattern
func initTelnyxClient() *telnyx.Client {
	apiKey := os.Getenv("TELNYX_API_KEY")
	return telnyx.NewClient(telnyx.WithAPIKey(apiKey))
}

// SendSMS sends an SMS via Telnyx and returns response data.
func SendSMS(client *telnyx.Client, toNumber string, message string) (map[string]interface{}, error) {
	fromNumber := os.Getenv("TELNYX_PHONE_NUMBER")
	if fromNumber == "" {
		return nil, fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}

	// Validate E.164 format to prevent API errors
	if !strings.HasPrefix(toNumber, "+") {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Create message request
	params := &messaging.CreateMessageParams{
		From: fromNumber,
		To:   toNumber,
		Text: message,
	}

	response, err := client.Messaging.CreateMessage(params)
	if err != nil {
		return nil, err
	}

	// Extract serializable data — SDK objects are NOT JSON-serializable
	status := "unknown"
	if response.Data != nil && len(response.Data.To) > 0 {
		status = response.Data.To[0].Status
	}

	return map[string]interface{}{
		"message_id": response.Data.ID,
		"status":     status,
		"from":       fromNumber,
		"to":         toNumber,
	}, nil
}

func main() {
	// Load environment variables
	godotenv.Load()

	// Initialize Telnyx client
	client := initTelnyxClient()

	// Create Gin router
	router := gin.Default()

	// Define SMS send endpoint
	router.POST("/sms/send", func(c *gin.Context) {
		var requestBody struct {
			To      string `json:"to" binding:"required"`
			Message string `json:"message" binding:"required"`
		}

		// Parse JSON request
		if err := c.ShouldBindJSON(&requestBody); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Missing required fields: 'to' and 'message'",
			})
			return
		}

		// Call SendSMS helper function
		result, err := SendSMS(client, requestBody.To, requestBody.Message)
		if err != nil {
			// Handle Telnyx-specific errors
			switch err.(type) {
			case *telnyx.AuthenticationError:
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Invalid API key",
				})
			case *telnyx.RateLimitError:
				c.JSON(http.StatusTooManyRequests, gin.H{
					"error": "Rate limit exceeded. Please slow down.",
				})
			case *telnyx.APIStatusError:
				apiErr := err.(*telnyx.APIStatusError)
				c.JSON(apiErr.StatusCode, gin.H{
					"error":       apiErr.Error(),
					"status_code": apiErr.StatusCode,
				})
			case *telnyx.APIConnectionError:
				c.JSON(http.StatusServiceUnavailable, gin.H{
					"error": "Network error connecting to Telnyx",
				})
			default:
				// Handle validation errors
				c.JSON(http.StatusBadRequest, gin.H{
					"error": err.Error(),
				})
			}
			return
		}

		// Return success response
		c.JSON(http.StatusOK, result)
	})

	// Start server
	router.Run(":5000")
}
