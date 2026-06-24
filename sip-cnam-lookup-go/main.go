package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4"
	"github.com/team-telnyx/telnyx-go/v4/option"
)

// Config holds application configuration.
type Config struct {
	APIKey string
	Port   string
}

// LoadConfig reads environment variables and returns a Config struct.
func LoadConfig() (*Config, error) {
	_ = godotenv.Load()

	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("TELNYX_API_KEY environment variable not set")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	return &Config{
		APIKey: apiKey,
		Port:   port,
	}, nil
}

// NewTelnyxClient initializes the Telnyx client with the provided API key.
func NewTelnyxClient(apiKey string) *telnyx.Client {
	return telnyx.NewClient(option.WithAPIKey(apiKey))
}

// CNAMResult represents the response data from a CNAM lookup.
type CNAMResult struct {
	PhoneNumber string `json:"phone_number"`
	CallerName  string `json:"caller_name"`
	CarrierName string `json:"carrier_name"`
	Status      string `json:"status"`
}

// PerformCNAMLookup queries the Telnyx CNAM API for caller information.
func PerformCNAMLookup(client *telnyx.Client, phoneNumber string) (*CNAMResult, error) {
	if len(phoneNumber) < 10 || phoneNumber[0] != '+' {
		return nil, fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	response, err := client.CnamLookups.Retrieve(
		context.Background(),
		phoneNumber,
	)
	if err != nil {
		return nil, err
	}

	result := &CNAMResult{
		PhoneNumber: phoneNumber,
		Status:      "success",
	}

	if response.Data != nil {
		if response.Data.CallerName != nil {
			result.CallerName = *response.Data.CallerName
		}
		if response.Data.CarrierName != nil {
			result.CarrierName = *response.Data.CarrierName
		}
	}

	return result, nil
}

func main() {
	config, err := LoadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	client := NewTelnyxClient(config.APIKey)
	router := gin.Default()

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	router.POST("/cnam/lookup", func(c *gin.Context) {
		var req struct {
			PhoneNumber string `json:"phone_number" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Missing required field: 'phone_number'",
			})
			return
		}

		result, err := PerformCNAMLookup(client, req.PhoneNumber)

		if err != nil {
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
				c.JSON(http.StatusBadRequest, gin.H{
					"error": err.Error(),
				})
				return
			}
		}

		c.JSON(http.StatusOK, result)
	})

	addr := fmt.Sprintf(":%s", config.Port)
	log.Printf("Starting CNAM lookup server on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
