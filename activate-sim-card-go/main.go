package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4"
	"github.com/team-telnyx/telnyx-go/v4/option"
)

// Initialize client with the v4 SDK pattern. NewClient returns a value, so we
// take its address to share a single client across handlers.
var client *telnyx.Client

func init() {
	// Load environment variables from .env file
	godotenv.Load()

	// Initialize Telnyx client with API key from environment
	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		panic("TELNYX_API_KEY environment variable not set")
	}

	clientValue := telnyx.NewClient(option.WithAPIKey(apiKey))
	client = &clientValue
}

// activateSIM enables a SIM card and returns JSON-serializable response data.
func activateSIM(simCardID string) (map[string]interface{}, error) {
	// Validate SIM card ID is not empty
	if simCardID == "" {
		return nil, fmt.Errorf("SIM card ID cannot be empty")
	}

	// Use client.SimCards.Actions.Enable() to enable the SIM. This triggers an
	// asynchronous SIM Card Action whose status can be polled separately.
	response, err := client.SimCards.Actions.Enable(context.Background(), simCardID)
	if err != nil {
		return nil, err
	}

	// Extract serializable data — the response Data is a SimCardAction tracking
	// the enable operation, so we unpack its real fields to a plain map.
	action := response.Data
	result := map[string]interface{}{
		"id":          action.ID,
		"sim_card_id": action.SimCardID,
		"action_type": action.ActionType,
		"status":      action.Status.Value,
		"created_at":  action.CreatedAt,
	}

	return result, nil
}

func main() {
	// Create Gin router
	router := gin.Default()

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// POST endpoint to activate (enable) a SIM card
	router.POST("/sim/activate", func(c *gin.Context) {
		// Parse JSON request body
		var request struct {
			SimCardID string `json:"sim_card_id" binding:"required"`
		}

		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Missing required field: 'sim_card_id'",
			})
			return
		}

		// Call helper function to activate SIM
		result, err := activateSIM(request.SimCardID)

		// Handle Telnyx API errors. The v4 SDK surfaces API failures as
		// *telnyx.Error, which carries the HTTP status code; fall back to a
		// generic 400 for any other error.
		if err != nil {
			var apiErr *telnyx.Error
			if errors.As(err, &apiErr) {
				c.JSON(apiErr.StatusCode, gin.H{
					"error":       apiErr.Error(),
					"status_code": apiErr.StatusCode,
				})
				return
			}
			c.JSON(http.StatusBadRequest, gin.H{
				"error": err.Error(),
			})
			return
		}

		// Return successful activation response
		c.JSON(http.StatusOK, result)
	})

	// Start the Gin server on port 8080
	router.Run(":8080")
}
