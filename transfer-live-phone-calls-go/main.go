package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
)

// Initialize Telnyx client at package level
var client *telnyx.Client

func init() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}

	// Initialize Telnyx client with API key
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

// CallTransferRequest represents the JSON payload for transferring a call
type CallTransferRequest struct {
	CallControlID string `json:"call_control_id" binding:"required"`
	TransferTo    string `json:"transfer_to" binding:"required"`
}

// initiateCall creates an outbound call and returns the call control ID
func initiateCall(toNumber string) (map[string]interface{}, error) {
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

	// Call the Telnyx API to initiate the call
	response, err := client.Calls.Dial(
		&telnyx.CallDialRequest{
			From:         fromNumber,
			To:           toNumber,
			ConnectionID: connectionID,
		},
	)
	if err != nil {
		return nil, err
	}

	// Extract serializable data — SDK objects are NOT JSON-serializable
	return map[string]interface{}{
		"call_control_id": response.Data.CallControlID,
		"from":            fromNumber,
		"to":              toNumber,
		"state":           response.Data.State,
	}, nil
}

// transferCall transfers an active call to another number
func transferCall(callControlID, transferTo string) (map[string]interface{}, error) {
	// Validate E.164 format
	if len(transferTo) == 0 || transferTo[0] != '+' {
		return nil, fmt.Errorf("transfer number must be in E.164 format (e.g., +15551234567)")
	}

	// Call the Telnyx API to transfer the call
	response, err := client.Calls.Actions.Transfer(
		callControlID,
		&telnyx.CallTransferRequest{
			To: transferTo,
		},
	)
	if err != nil {
		return nil, err
	}

	// Extract serializable data
	return map[string]interface{}{
		"call_control_id": response.Data.CallControlID,
		"transfer_to":     transferTo,
		"state":           response.Data.State,
	}, nil
}

func main() {
	router := gin.Default()

	// Route to initiate a call
	router.POST("/calls/initiate", func(c *gin.Context) {
		var req CallInitiateRequest

		// Parse JSON request body
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Missing required field: 'to'",
			})
			return
		}

		// Call the helper function
		result, err := initiateCall(req.To)
		if err != nil {
			// Handle Telnyx SDK errors
			if apiErr, ok := err.(*telnyx.APIError); ok {
				switch apiErr.Status {
				case http.StatusUnauthorized:
					c.JSON(http.StatusUnauthorized, gin.H{
						"error": "Invalid API key",
					})
				case http.StatusTooManyRequests:
					c.JSON(http.StatusTooManyRequests, gin.H{
						"error": "Rate limit exceeded. Please slow down.",
					})
				default:
					c.JSON(apiErr.Status, gin.H{
						"error":       apiErr.Message,
						"status_code": apiErr.Status,
					})
				}
			} else {
				// Handle validation and other errors
				c.JSON(http.StatusBadRequest, gin.H{
					"error": err.Error(),
				})
			}
			return
		}

		c.JSON(http.StatusOK, result)
	})

	// Route to transfer an active call
	router.POST("/calls/transfer", func(c *gin.Context) {
		var req CallTransferRequest

		// Parse JSON request body
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Missing required fields: 'call_control_id' and 'transfer_to'",
			})
			return
		}

		// Call the helper function
		result, err := transferCall(req.CallControlID, req.TransferTo)
		if err != nil {
			// Handle Telnyx SDK errors
			if apiErr, ok := err.(*telnyx.APIError); ok {
				switch apiErr.Status {
				case http.StatusUnauthorized:
					c.JSON(http.StatusUnauthorized, gin.H{
						"error": "Invalid API key",
					})
				case http.StatusTooManyRequests:
					c.JSON(http.StatusTooManyRequests, gin.H{
						"error": "Rate limit exceeded. Please slow down.",
					})
				default:
					c.JSON(apiErr.Status, gin.H{
						"error":       apiErr.Message,
						"status_code": apiErr.Status,
					})
				}
			} else {
				// Handle validation and other errors
				c.JSON(http.StatusBadRequest, gin.H{
					"error": err.Error(),
				})
			}
			return
		}

		c.JSON(http.StatusOK, result)
	})

	// Webhook endpoint to receive call events
	router.POST("/webhooks/call-events", func(c *gin.Context) {
		var event map[string]interface{}

		if err := c.ShouldBindJSON(&event); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid webhook payload",
			})
			return
		}

		// Log the event for debugging
		eventType, _ := event["data"].(map[string]interface{})["event_type"]
		log.Printf("Received call event: %v\n", eventType)

		// Acknowledge the webhook
		c.JSON(http.StatusOK, gin.H{
			"status": "received",
		})
	})

	// Start the Gin server
	if err := router.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
