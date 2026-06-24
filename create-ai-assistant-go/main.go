package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go/v2"
	"github.com/telnyx/telnyx-go/v2/option"
)

// CreateAssistantRequest represents the input for creating an AI assistant.
type CreateAssistantRequest struct {
	Name            string   `json:"name" binding:"required"`
	Model           string   `json:"model" binding:"required"`
	Instructions    string   `json:"instructions"`
	EnabledFeatures []string `json:"enabled_features"`
}

// AssistantResponse represents the JSON-serializable response data.
type AssistantResponse struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Model           string   `json:"model"`
	Instructions    string   `json:"instructions"`
	EnabledFeatures []string `json:"enabled_features"`
	CreatedAt       string   `json:"created_at"`
}

// InitClient initializes and returns a Telnyx client using the API key from environment.
func InitClient() *telnyx.Client {
	// Load .env file if it exists (optional for production)
	_ = godotenv.Load()

	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		log.Fatal("TELNYX_API_KEY environment variable not set")
	}

	// Initialize client with the SDK pattern
	client := telnyx.NewClient(option.WithAPIKey(apiKey))
	return client
}

// CreateAssistant creates a new AI assistant via the Telnyx API.
// Returns a JSON-serializable response or an error.
func CreateAssistant(client *telnyx.Client, req CreateAssistantRequest) (*AssistantResponse, error) {
	// Validate required fields
	if req.Name == "" {
		return nil, fmt.Errorf("assistant name is required")
	}
	if req.Model == "" {
		return nil, fmt.Errorf("model is required")
	}

	// Build the create request with optional fields
	params := telnyx.AIAssistantCreateParams{
		Name:  telnyx.F(req.Name),
		Model: telnyx.F(req.Model),
	}

	if req.Instructions != "" {
		params.Instructions = telnyx.F(req.Instructions)
	}

	if len(req.EnabledFeatures) > 0 {
		params.EnabledFeatures = telnyx.F(req.EnabledFeatures)
	}

	// Call the API — use client.AIAssistants.New() for creation
	response, err := client.AIAssistants.New(context.Background(), params)
	if err != nil {
		return nil, err
	}

	// Extract serializable data from the SDK response object
	return &AssistantResponse{
		ID:              response.ID,
		Name:            response.Name,
		Model:           response.Model,
		Instructions:    response.Instructions,
		EnabledFeatures: response.EnabledFeatures,
		CreatedAt:       response.CreatedAt.String(),
	}, nil
}

func main() {
	// Initialize Telnyx client
	client := InitClient()

	// Create Gin router
	router := gin.Default()

	// POST /assistants — create a new AI assistant
	router.POST("/assistants", func(c *gin.Context) {
		var req CreateAssistantRequest

		// Bind and validate JSON request body
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid request body: " + err.Error(),
			})
			return
		}

		// Call helper function — exception handling happens here in the route
		response, err := CreateAssistant(client, req)

		// Handle Telnyx-specific errors
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
				// Generic validation or other errors
				c.JSON(http.StatusBadRequest, gin.H{
					"error": err.Error(),
				})
				return
			}
		}

		// Return the created assistant as JSON
		c.JSON(http.StatusCreated, response)
	})

	// Start the server
	log.Println("Starting server on :8080")
	if err := router.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
