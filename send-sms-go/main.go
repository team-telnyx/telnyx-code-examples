package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4"
	"github.com/team-telnyx/telnyx-go/v4/option"
)

// Initialize client with the new SDK pattern.
// NewClient returns a value Client, so we take its address to share a single
// client across handlers.
func initTelnyxClient() *telnyx.Client {
	apiKey := os.Getenv("TELNYX_API_KEY")
	client := telnyx.NewClient(option.WithAPIKey(apiKey))
	return &client
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

	// Create message request. Service methods take a context as the first
	// argument and the params as a value struct.
	params := telnyx.MessageSendParams{
		To:   toNumber,
		From: telnyx.String(fromNumber),
		Text: telnyx.String(message),
	}

	response, err := client.Messages.Send(context.Background(), params)
	if err != nil {
		return nil, err
	}

	// Extract serializable data — SDK objects are NOT JSON-serializable
	status := "unknown"
	if len(response.Data.To) > 0 {
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
			// Handle Telnyx API errors. The SDK surfaces API failures as
			// *telnyx.Error, which carries the HTTP status code.
			var apiErr *telnyx.Error
			if errors.As(err, &apiErr) {
				c.JSON(apiErr.StatusCode, gin.H{
					"error":       apiErr.Error(),
					"status_code": apiErr.StatusCode,
				})
				return
			}

			// Handle validation and other errors
			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
			})
			return
		}

		// Return success response
		c.JSON(http.StatusOK, result)
	})

	// Start server
	router.Run(":5000")
}
