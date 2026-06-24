package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4"
	"github.com/team-telnyx/telnyx-go/v4/option"
)

var client *telnyx.Client

func init() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}

	// Initialize Telnyx client with API key from environment
	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		log.Fatal("TELNYX_API_KEY environment variable not set")
	}

	client = telnyx.NewClient(option.WithAPIKey(apiKey))
}

// CloneAssistantRequest represents the incoming request payload.
type CloneAssistantRequest struct {
	AssistantID string `json:"assistant_id" binding:"required"`
	NewName     string `json:"new_name" binding:"required"`
}

// AssistantResponse represents the cloned assistant data for JSON serialization.
type AssistantResponse struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Model             string   `json:"model"`
	Instructions      string   `json:"instructions"`
	EnabledFeatures   []string `json:"enabled_features"`
	CreatedAt         string   `json:"created_at"`
	SourceAssistantID string   `json:"source_assistant_id"`
}

// cloneAssistant clones an existing assistant with a new name.
// Returns the cloned assistant data or an error.
func cloneAssistant(assistantID string, newName string) (*AssistantResponse, error) {
	// Call the Telnyx API to clone the assistant
	response, err := client.AIAssistants.Clone(assistantID, &telnyx.AIAssistantCloneParams{
		Name: telnyx.F(newName),
	})
	if err != nil {
		return nil, err
	}

	// Extract serializable data from the SDK response
	// SDK objects are NOT JSON-serializable, so we unpack to a plain struct
	clonedAssistant := &AssistantResponse{
		ID:                response.Result.ID,
		Name:              response.Result.Name,
		Model:             response.Result.Model,
		Instructions:      response.Result.Instructions,
		EnabledFeatures:   response.Result.EnabledFeatures,
		CreatedAt:         response.Result.CreatedAt.String(),
		SourceAssistantID: assistantID,
	}

	return clonedAssistant, nil
}

// setupRoutes configures all Gin routes with error handling.
func setupRoutes(router *gin.Engine) {
	router.POST("/assistants/clone", cloneAssistantHandler)
}

// cloneAssistantHandler is the HTTP endpoint to clone an AI Assistant.
// Catches Telnyx exceptions and maps them to appropriate HTTP status codes.
func cloneAssistantHandler(c *gin.Context) {
	var req CloneAssistantRequest

	// Parse and validate the incoming JSON request
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid request body: " + err.Error(),
		})
		return
	}

	// Validate that assistant_id is not empty
	if req.AssistantID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "assistant_id cannot be empty",
		})
		return
	}

	// Validate that new_name is not empty
	if req.NewName == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "new_name cannot be empty",
		})
		return
	}

	// Call the helper function to clone the assistant
	clonedAssistant, err := cloneAssistant(req.AssistantID, req.NewName)

	// Handle Telnyx API errors with appropriate HTTP status codes
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
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "An unexpected error occurred: " + err.Error(),
			})
			return
		}
	}

	// Return the cloned assistant data as JSON
	c.JSON(http.StatusOK, clonedAssistant)
}

func main() {
	// Create a new Gin router with default middleware
	router := gin.Default()

	// Setup all routes
	setupRoutes(router)

	// Start the HTTP server on port 8080
	log.Println("Starting server on :8080")
	if err := router.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
