package main

import (
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go/v2"
	"github.com/telnyx/telnyx-go/v2/option"
)

// Config holds application configuration.
type Config struct {
	TelnyxAPIKey   string
	TelnyxPhoneNum string
	RateLimitDelay time.Duration
	MaxConcurrency int
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() *Config {
	_ = godotenv.Load()

	return &Config{
		TelnyxAPIKey:   os.Getenv("TELNYX_API_KEY"),
		TelnyxPhoneNum: os.Getenv("TELNYX_PHONE_NUMBER"),
		RateLimitDelay: 100 * time.Millisecond,
		MaxConcurrency: 5,
	}
}

// MessageResult represents the outcome of a single SMS send attempt.
type MessageResult struct {
	To        string `json:"to"`
	MessageID string `json:"message_id,omitempty"`
	Status    string `json:"status"`
	Error     string `json:"error,omitempty"`
}

// BulkSMSRequest represents the incoming request payload.
type BulkSMSRequest struct {
	Recipients []string `json:"recipients"`
	Message    string   `json:"message"`
}

// SendBulkSMS sends SMS to multiple recipients with rate limiting and concurrency control.
func SendBulkSMS(client *telnyx.Client, config *Config, req *BulkSMSRequest) ([]MessageResult, error) {
	if len(req.Recipients) == 0 {
		return nil, fmt.Errorf("recipients list cannot be empty")
	}

	if req.Message == "" {
		return nil, fmt.Errorf("message text cannot be empty")
	}

	results := make([]MessageResult, len(req.Recipients))
	resultsMutex := &sync.Mutex{}

	// Semaphore to limit concurrent goroutines.
	semaphore := make(chan struct{}, config.MaxConcurrency)
	var wg sync.WaitGroup

	// Rate limiter: ticker ensures minimum delay between API calls.
	rateLimiter := time.NewTicker(config.RateLimitDelay)
	defer rateLimiter.Stop()

	for i, recipient := range req.Recipients {
		wg.Add(1)

		go func(index int, to string) {
			defer wg.Done()

			// Acquire semaphore slot.
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			// Wait for rate limiter tick.
			<-rateLimiter.C

			// Validate E.164 format.
			if len(to) == 0 || to[0] != '+' {
				resultsMutex.Lock()
				results[index] = MessageResult{
					To:     to,
					Status: "failed",
					Error:  "Phone number must be in E.164 format (e.g., +15551234567)",
				}
				resultsMutex.Unlock()
				return
			}

			// Send the message via Telnyx API.
			response, err := client.Messages.Create(&telnyx.MessageCreateParams{
				From: telnyx.String(config.TelnyxPhoneNum),
				To:   telnyx.String(to),
				Text: telnyx.String(req.Message),
			})

			resultsMutex.Lock()
			defer resultsMutex.Unlock()

			if err != nil {
				errorMsg := err.Error()
				results[index] = MessageResult{
					To:     to,
					Status: "failed",
					Error:  errorMsg,
				}
				return
			}

			// Extract serializable data from the response.
			status := "queued"
			if response.Data != nil && len(response.Data.To) > 0 {
				status = response.Data.To[0].Status
			}

			results[index] = MessageResult{
				To:        to,
				MessageID: response.Data.ID,
				Status:    status,
			}
		}(i, recipient)
	}

	wg.Wait()
	return results, nil
}

func main() {
	// Load configuration from environment.
	config := LoadConfig()

	// Validate required configuration.
	if config.TelnyxAPIKey == "" {
		panic("TELNYX_API_KEY environment variable not set")
	}
	if config.TelnyxPhoneNum == "" {
		panic("TELNYX_PHONE_NUMBER environment variable not set")
	}

	// Initialize Telnyx client with API key.
	client := telnyx.NewClient(option.WithAPIKey(config.TelnyxAPIKey))

	// Create Gin router.
	router := gin.Default()

	// POST /sms/bulk - Send bulk SMS to multiple recipients.
	router.POST("/sms/bulk", func(c *gin.Context) {
		var req BulkSMSRequest

		// Parse JSON request body.
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid request body: " + err.Error(),
			})
			return
		}

		// Validate request fields.
		if len(req.Recipients) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Missing required field: 'recipients' (non-empty list)",
			})
			return
		}

		if req.Message == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Missing required field: 'message'",
			})
			return
		}

		// Send bulk SMS and handle errors.
		results, err := SendBulkSMS(client, config, &req)

		// Handle fatal errors (not per-message failures).
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
			})
			return
		}

		// Return results for all recipients.
		c.JSON(http.StatusOK, gin.H{
			"total":   len(results),
			"results": results,
		})
	})

	// Health check endpoint.
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
		})
	})

	// Start the server on port 8080.
	router.Run(":8080")
}
