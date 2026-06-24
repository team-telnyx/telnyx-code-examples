package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2"
)

// AssistantResponse represents a serializable AI assistant object.
type AssistantResponse struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Model            string   `json:"model"`
	Instructions     string   `json:"instructions"`
	EnabledFeatures  []string `json:"enabled_features"`
	CreatedAt        string   `json:"created_at"`
}

// ListAssistantsResponse wraps the list of assistants with pagination metadata.
type ListAssistantsResponse struct {
	Data       []AssistantResponse `json:"data"`
	PageNumber int                 `json:"page_number"`
	PageSize   int                 `json:"page_size"`
	Total      int                 `json:"total"`
}

func init() {
	// Load environment variables from .env file
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using system environment variables")
	}
}

// listAssistants fetches all AI assistants from Telnyx and returns serializable data.
// Handles pagination to retrieve all assistants across multiple pages.
func listAssistants(pageNumber, pageSize int) (*ListAssistantsResponse, error) {
	// Initialize client with API key from environment
	client := telnyx.NewClient(option.WithAPIKey(os.Getenv("TELNYX_API_KEY")))

	// Fetch assistants with pagination parameters
	params := &v2.ListAIAssistantsParams{
		PageNumber: pageNumber,
		PageSize:   pageSize,
	}

	response, err := client.AIAssistants.List(params)
	if err != nil {
		return nil, err
	}

	// Serialize SDK response objects to plain maps — SDK objects are NOT JSON-serializable
	assistants := make([]AssistantResponse, 0, len(response.Data))
	for _, assistant := range response.Data {
		assistants = append(assistants, AssistantResponse{
			ID:              assistant.ID,
			Name:            assistant.Name,
			Model:           assistant.Model,
			Instructions:    assistant.Instructions,
			EnabledFeatures: assistant.EnabledFeatures,
			CreatedAt:       assistant.CreatedAt,
		})
	}

	return &ListAssistantsResponse{
		Data:       assistants,
		PageNumber: pageNumber,
		PageSize:   pageSize,
		Total:      response.Meta.Total,
	}, nil
}

func main() {
	// Initialize Gin router
	router := gin.Default()

	// Define error handler middleware for Telnyx exceptions
	router.Use(func(c *gin.Context) {
		c.Next()
		// Error handling is done in individual route handlers
	})

	// GET /assistants — list all AI assistants with pagination support
	router.GET("/assistants", func(c *gin.Context) {
		// Parse pagination parameters from query string
		pageNumber := 1
		pageSize := 10

		if page := c.Query("page"); page != "" {
			if p, err := strconv.Atoi(page); err == nil && p > 0 {
				pageNumber = p
			}
		}

		if size := c.Query("page_size"); size != "" {
			if s, err := strconv.Atoi(size); err == nil && s > 0 && s <= 100 {
				pageSize = s
			}
		}

		// Call helper function to fetch assistants
		result, err := listAssistants(pageNumber, pageSize)

		// Handle Telnyx-specific errors with appropriate HTTP status codes
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
				statusErr := err.(*telnyx.APIStatusError)
				c.JSON(statusErr.StatusCode, gin.H{
					"error":       statusErr.Error(),
					"status_code": statusErr.StatusCode,
				})
				return
			case *telnyx.APIConnectionError:
				c.JSON(http.StatusServiceUnavailable, gin.H{
					"error": "Network error connecting to Telnyx",
				})
				return
			default:
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": fmt.Sprintf("Unexpected error: %v", err),
				})
				return
			}
		}

		// Return serialized response
		c.JSON(http.StatusOK, result)
	})

	// GET /assistants/:id — retrieve a single assistant by ID
	router.GET("/assistants/:id", func(c *gin.Context) {
		assistantID := c.Param("id")

		if assistantID == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Assistant ID is required",
			})
			return
		}

		// Initialize client and fetch single assistant
		client := telnyx.NewClient(option.WithAPIKey(os.Getenv("TELNYX_API_KEY")))
		response, err := client.AIAssistants.Get(assistantID)

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
				statusErr := err.(*telnyx.APIStatusError)
				c.JSON(statusErr.StatusCode, gin.H{
					"error":       statusErr.Error(),
					"status_code": statusErr.StatusCode,
				})
				return
			case *telnyx.APIConnectionError:
				c.JSON(http.StatusServiceUnavailable, gin.H{
					"error": "Network error connecting to Telnyx",
				})
				return
			default:
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": fmt.Sprintf("Unexpected error: %v", err),
				})
				return
			}
		}

		// Serialize single assistant response
		assistant := AssistantResponse{
			ID:              response.Data.ID,
			Name:            response.Data.Name,
			Model:           response.Data.Model,
			Instructions:    response.Data.Instructions,
			EnabledFeatures: response.Data.EnabledFeatures,
			CreatedAt:       response.Data.CreatedAt,
		}

		c.JSON(http.StatusOK, assistant)
	})

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
		})
	})

	// Start server on configured port
	port := os.Getenv("GIN_PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting Gin server on port %s\n", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
