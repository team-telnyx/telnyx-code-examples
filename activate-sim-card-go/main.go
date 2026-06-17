package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go/v2"
)

// Initialize client with the new SDK pattern
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

// activateSIM activates a SIM card and returns JSON-serializable response data.
func activateSIM(simCardID string) (map[string]interface{}, error) {
	// Validate SIM card ID is not empty
	if simCardID == "" {
		return nil, fmt.Errorf("SIM card ID cannot be empty")
	}

	// Use client.SimCards.Activate() to activate the SIM
	response, err := client.SimCards.Activate(simCardID, nil)
	if err != nil {
		return nil, err
	}

	// Extract serializable data — SDK objects must be unpacked to plain maps
	result := map[string]interface{}{
		"id":                response.Data.ID,
		"iccid":             response.Data.ICCID,
		"status":            response.Data.Status,
		"sim_card_group_id": response.Data.SimCardGroupID,
	}

	return result, nil
}

func main() {
	// Create Gin router
	router := gin.Default()

	// POST endpoint to activate a SIM card
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

		// Handle Telnyx API errors
		if err != nil {
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
				c.JSON(http.StatusBadRequest, gin.H{
					"error": err.Error(),
				})
			}
			return
		}

		// Return successful activation response
		c.JSON(http.StatusOK, result)
	})

	// Start the Gin server on port 8080
	router.Run(":8080")
}
