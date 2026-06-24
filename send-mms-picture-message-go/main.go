package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
)

// Initialize client with the Go SDK pattern
var client *telnyx.Client

func init() {
	// Load environment variables from .env file
	godotenv.Load()

	// Initialize Telnyx client with API key from environment
	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		panic("TELNYX_API_KEY environment variable not set")
	}

	client = telnyx.NewClient(telnyx.WithAPIKey(apiKey))
}

// SendMMSRequest represents the incoming HTTP request payload
type SendMMSRequest struct {
	To        string   `json:"to" binding:"required"`
	Message   string   `json:"message" binding:"required"`
	MediaURLs []string `json:"media_urls" binding:"required"`
}

// SendMMSResponse represents the JSON-serializable response
type SendMMSResponse struct {
	MessageID string   `json:"message_id"`
	Status    string   `json:"status"`
	From      string   `json:"from"`
	To        string   `json:"to"`
	MediaURLs []string `json:"media_urls"`
}

// sendMMS sends an MMS message via Telnyx and returns serializable response data
func sendMMS(toNumber string, message string, mediaURLs []string) (*SendMMSResponse, error) {
	fromNumber := os.Getenv("TELNYX_PHONE_NUMBER")
	if fromNumber == "" {
		return nil, fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}

	// Validate E.164 format to prevent API errors
	if !strings.HasPrefix(toNumber, "+") {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Validate media URLs are provided
	if len(mediaURLs) == 0 {
		return nil, fmt.Errorf("at least one media URL is required for MMS")
	}

	// Create MMS message with media URLs
	params := &telnyx.MessageCreateParams{
		From:      fromNumber,
		To:        toNumber,
		Text:      message,
		MediaURLs: mediaURLs,
	}

	response, err := client.Messages.Create(params)
	if err != nil {
		return nil, err
	}

	// Extract serializable data — SDK objects are NOT JSON-serializable
	status := "unknown"
	if response.Data != nil && len(response.Data.To) > 0 {
		status = response.Data.To[0].Status
	}

	return &SendMMSResponse{
		MessageID: response.Data.ID,
		Status:    status,
		From:      fromNumber,
		To:        toNumber,
		MediaURLs: mediaURLs,
	}, nil
}

func main() {
	router := gin.Default()

	// POST endpoint to send MMS
	router.POST("/mms/send", func(c *gin.Context) {
		var req SendMMSRequest

		// Parse JSON request body
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("Invalid request: %v", err),
			})
			return
		}

		// Call helper function to send MMS
		result, err := sendMMS(req.To, req.Message, req.MediaURLs)
		if err != nil {
			// Handle Telnyx SDK errors with appropriate HTTP status codes
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
				// Handle validation errors and other issues
				c.JSON(http.StatusBadRequest, gin.H{
					"error": err.Error(),
				})
			}
			return
		}

		// Return successful response
		c.JSON(http.StatusOK, result)
	})

	// Start the Gin server on port 8080
	router.Run(":8080")
}
