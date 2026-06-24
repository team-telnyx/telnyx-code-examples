package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4/v2"
)

// LoadConfig reads environment variables and initializes the Telnyx client.
func LoadConfig() *telnyx.Client {
	// Load .env file if it exists (optional for production).
	_ = godotenv.Load()

	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		log.Fatal("TELNYX_API_KEY environment variable not set")
	}

	// Initialize client with the new SDK pattern.
	client := telnyx.NewClient(telnyx.WithAPIKey(apiKey))
	return client
}

// GetPort returns the port from environment or defaults to 8080.
func GetPort() string {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	return port
}

// NumberLookupResult represents the serializable response from a number lookup.
type NumberLookupResult struct {
	PhoneNumber  string `json:"phone_number"`
	Carrier      string `json:"carrier"`
	LineType     string `json:"line_type"`
	Country      string `json:"country"`
	PortedStatus string `json:"ported_status"`
	LookupID     string `json:"lookup_id"`
	RequestID    string `json:"request_id"`
}

// PerformNumberLookup queries the Telnyx API for phone number details.
// This function does NOT handle exceptions — they are caught in the route handler.
func PerformNumberLookup(client *telnyx.Client, phoneNumber string) (*NumberLookupResult, error) {
	// Validate E.164 format to prevent API errors.
	if phoneNumber == "" {
		return nil, fmt.Errorf("phone number cannot be empty")
	}
	if phoneNumber[0] != '+' {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	// Call the number lookup API.
	params := &telnyx.NumberLookupCreateParams{
		PhoneNumber: phoneNumber,
	}

	response, err := client.NumberLookups.Create(params)
	if err != nil {
		return nil, err
	}

	// Extract serializable data from the SDK response.
	// SDK objects are NOT JSON-serializable — always unpack to plain structs.
	result := &NumberLookupResult{
		PhoneNumber:  response.Data.PhoneNumber,
		Carrier:      response.Data.Carrier,
		LineType:     response.Data.LineType,
		Country:      response.Data.Country,
		PortedStatus: response.Data.PortedStatus,
		LookupID:     response.Data.ID,
		RequestID:    response.RequestID,
	}

	return result, nil
}

// handleNumberLookup is the HTTP route handler for number lookup requests.
// Exception handling is performed here, not in helper functions.
func handleNumberLookup(c *gin.Context, client *telnyx.Client) {
	// Parse JSON request body.
	var req struct {
		PhoneNumber string `json:"phone_number" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Missing required field: 'phone_number'",
		})
		return
	}

	// Call the lookup helper function.
	result, err := PerformNumberLookup(client, req.PhoneNumber)

	// Handle Telnyx SDK exceptions in the route handler.
	if err != nil {
		// Check for specific Telnyx error types.
		switch err.(type) {
		case *telnyx.AuthenticationError:
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid API key",
			})
			return

		case *telnyx.RateLimitError:
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded. Please slow down.",
			})
			return

		case *telnyx.APIStatusError:
			apiErr := err.(*telnyx.APIStatusError)
			c.JSON(apiErr.StatusCode, gin.H{
				"error":       apiErr.Error(),
				"status_code": apiErr.StatusCode,
			})
			return

		case *telnyx.APIConnectionError:
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "Network error connecting to Telnyx",
			})
			return

		default:
			// Handle validation errors (from PerformNumberLookup).
			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
			})
			return
		}
	}

	// Return successful lookup result.
	c.JSON(http.StatusOK, result)
}

func main() {
	// Initialize Telnyx client.
	client := LoadConfig()
	port := GetPort()

	// Create Gin router.
	router := gin.Default()

	// Register routes.
	router.POST("/lookup", func(c *gin.Context) {
		handleNumberLookup(c, client)
	})

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Start server.
	log.Printf("Starting server on port %s\n", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
