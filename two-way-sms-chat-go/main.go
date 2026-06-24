package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go/v2"
	"github.com/telnyx/telnyx-go/v2/option"
)

// Config holds application configuration.
type Config struct {
	TelnyxAPIKey   string
	TelnyxPhoneNum string
	WebhookURL     string
	Port           string
}

// SendSMSRequest represents the JSON payload for sending SMS.
type SendSMSRequest struct {
	To      string `json:"to" binding:"required"`
	Message string `json:"message" binding:"required"`
}

// SendSMSResponse represents the JSON response after sending SMS.
type SendSMSResponse struct {
	MessageID string `json:"message_id"`
	Status    string `json:"status"`
	From      string `json:"from"`
	To        string `json:"to"`
}

// InboundSMSEvent represents a webhook payload for inbound SMS.
type InboundSMSEvent struct {
	Data struct {
		ID        string `json:"id"`
		Direction string `json:"direction"`
		From      struct {
			PhoneNumber string `json:"phone_number"`
		} `json:"from"`
		To []struct {
			PhoneNumber string `json:"phone_number"`
		} `json:"to"`
		Text string `json:"text"`
	} `json:"data"`
}

var config Config
var client *telnyx.Client

func init() {
	// Load .env file if it exists (optional for production).
	_ = godotenv.Load()

	config = Config{
		TelnyxAPIKey:   os.Getenv("TELNYX_API_KEY"),
		TelnyxPhoneNum: os.Getenv("TELNYX_PHONE_NUMBER"),
		WebhookURL:     os.Getenv("WEBHOOK_URL"),
		Port:           os.Getenv("PORT"),
	}

	if config.Port == "" {
		config.Port = "8080"
	}

	if config.TelnyxAPIKey == "" {
		panic("TELNYX_API_KEY environment variable not set")
	}

	if config.TelnyxPhoneNum == "" {
		panic("TELNYX_PHONE_NUMBER environment variable not set")
	}

	// Initialize Telnyx client with API key.
	client = telnyx.NewClient(option.WithAPIKey(config.TelnyxAPIKey))
}

// SendSMS sends an outbound SMS message via Telnyx.
func SendSMS(toNumber, message string) (*SendSMSResponse, error) {
	// Validate E.164 format to prevent API errors.
	if !strings.HasPrefix(toNumber, "+") {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Create message via Telnyx API.
	params := &telnyx.MessageCreateParams{
		From: telnyx.String(config.TelnyxPhoneNum),
		To:   telnyx.String(toNumber),
		Text: telnyx.String(message),
	}

	response, err := client.Messages.Create(params)
	if err != nil {
		return nil, err
	}

	// Extract serializable data from SDK response.
	status := "unknown"
	if response.Data != nil && len(response.Data.To) > 0 {
		status = response.Data.To[0].Status
	}

	return &SendSMSResponse{
		MessageID: response.Data.ID,
		Status:    status,
		From:      config.TelnyxPhoneNum,
		To:        toNumber,
	}, nil
}

// SendSMSHandler handles POST /sms/send requests.
func SendSMSHandler(c *gin.Context) {
	var req SendSMSRequest

	// Bind and validate JSON request body.
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields: 'to' and 'message'"})
		return
	}

	// Call SendSMS helper function.
	result, err := SendSMS(req.To, req.Message)

	// Handle Telnyx SDK errors with appropriate HTTP status codes.
	if err != nil {
		switch err.(type) {
		case *telnyx.AuthenticationError:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
			return
		case *telnyx.RateLimitError:
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
			return
		case *telnyx.APIStatusError:
			apiErr := err.(*telnyx.APIStatusError)
			c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error(), "status_code": apiErr.StatusCode})
			return
		case *telnyx.APIConnectionError:
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
			return
		default:
			// Handle validation errors (E.164 format, etc.).
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	c.JSON(http.StatusOK, result)
}

// ReceiveSMSHandler handles POST /webhooks/sms requests for inbound messages.
func ReceiveSMSHandler(c *gin.Context) {
	var event InboundSMSEvent

	// Bind webhook payload.
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	// Log inbound message details (in production, store in database).
	fmt.Printf("Inbound SMS received:\n")
	fmt.Printf("  Message ID: %s\n", event.Data.ID)
	fmt.Printf("  From: %s\n", event.Data.From.PhoneNumber)
	if len(event.Data.To) > 0 {
		fmt.Printf("  To: %s\n", event.Data.To[0].PhoneNumber)
	}
	fmt.Printf("  Text: %s\n", event.Data.Text)

	// Acknowledge webhook receipt with 200 OK.
	c.JSON(http.StatusOK, gin.H{"status": "received"})
}

func main() {
	// Create Gin router with default middleware.
	router := gin.Default()

	// Define routes.
	router.POST("/sms/send", SendSMSHandler)
	router.POST("/webhooks/sms", ReceiveSMSHandler)

	// Health check endpoint.
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Start server.
	fmt.Printf("Starting Telnyx two-way SMS server on port %s\n", config.Port)
	if err := router.Run(":" + config.Port); err != nil {
		panic(err)
	}
}
