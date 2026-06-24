package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4/v2"
	"github.com/team-telnyx/telnyx-go/v4/v2/option"
)

// Config holds application configuration and the Telnyx client.
type Config struct {
	APIKey        string
	ESIMProfileID string
	Port          string
	TelnyxClient  *telnyx.Client
}

// LoadConfig loads environment variables and initializes the Telnyx client.
func LoadConfig() (*Config, error) {
	_ = godotenv.Load()

	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("TELNYX_API_KEY environment variable not set")
	}

	esimProfileID := os.Getenv("TELNYX_ESIM_PROFILE_ID")
	if esimProfileID == "" {
		return nil, fmt.Errorf("TELNYX_ESIM_PROFILE_ID environment variable not set")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	client := telnyx.NewClient(option.WithAPIKey(apiKey))

	return &Config{
		APIKey:        apiKey,
		ESIMProfileID: esimProfileID,
		Port:          port,
		TelnyxClient:  client,
	}, nil
}

// ProvisioningRequest represents the incoming eSIM provisioning request.
type ProvisioningRequest struct {
	DeviceID       string `json:"device_id" binding:"required"`
	DeviceName     string `json:"device_name"`
	SimCardGroupID string `json:"sim_card_group_id" binding:"required"`
}

// ProvisioningResponse represents the response after provisioning an eSIM.
type ProvisioningResponse struct {
	ID             string `json:"id"`
	ICCID          string `json:"iccid"`
	Status         string `json:"status"`
	SimCardGroupID string `json:"sim_card_group_id"`
	DeviceID       string `json:"device_id"`
	ActivationCode string `json:"activation_code,omitempty"`
}

// ProvisionESIM creates and activates an eSIM profile for a device.
func ProvisionESIM(client *telnyx.Client, req *ProvisioningRequest) (*ProvisioningResponse, error) {
	if len(req.DeviceID) == 0 {
		return nil, fmt.Errorf("device_id cannot be empty")
	}

	simCardParams := &telnyx.SimCardCreateParams{
		SimCardGroupID: telnyx.String(req.SimCardGroupID),
	}

	response, err := client.SimCards.Create(simCardParams)
	if err != nil {
		return nil, fmt.Errorf("failed to create SIM card: %w", err)
	}

	provisioningResp := &ProvisioningResponse{
		ID:             response.Data.ID,
		ICCID:          response.Data.ICCID,
		Status:         response.Data.Status,
		SimCardGroupID: response.Data.SimCardGroupID,
		DeviceID:       req.DeviceID,
		ActivationCode: generateActivationCode(response.Data.ID),
	}

	return provisioningResp, nil
}

// GetESIMStatus retrieves the current status of a provisioned eSIM.
func GetESIMStatus(client *telnyx.Client, simCardID string) (*ProvisioningResponse, error) {
	if len(simCardID) == 0 {
		return nil, fmt.Errorf("sim_card_id cannot be empty")
	}

	response, err := client.SimCards.Retrieve(simCardID)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve SIM card: %w", err)
	}

	statusResp := &ProvisioningResponse{
		ID:             response.Data.ID,
		ICCID:          response.Data.ICCID,
		Status:         response.Data.Status,
		SimCardGroupID: response.Data.SimCardGroupID,
	}

	return statusResp, nil
}

// ActivateESIM activates a provisioned eSIM profile.
func ActivateESIM(client *telnyx.Client, simCardID string) (*ProvisioningResponse, error) {
	if len(simCardID) == 0 {
		return nil, fmt.Errorf("sim_card_id cannot be empty")
	}

	activateParams := &telnyx.SimCardActivateParams{}
	response, err := client.SimCards.Activate(simCardID, activateParams)
	if err != nil {
		return nil, fmt.Errorf("failed to activate SIM card: %w", err)
	}

	activateResp := &ProvisioningResponse{
		ID:             response.Data.ID,
		ICCID:          response.Data.ICCID,
		Status:         response.Data.Status,
		SimCardGroupID: response.Data.SimCardGroupID,
	}

	return activateResp, nil
}

// generateActivationCode creates a mock activation code for demonstration.
func generateActivationCode(simCardID string) string {
	return fmt.Sprintf("AC-%s", simCardID[:8])
}

// handleTelnyxError maps Telnyx SDK errors to appropriate HTTP status codes.
func handleTelnyxError(c *gin.Context, err error) {
	switch e := err.(type) {
	case *telnyx.AuthenticationError:
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid API key or authentication failed",
		})
	case *telnyx.RateLimitError:
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error": "Rate limit exceeded. Please slow down.",
		})
	case *telnyx.APIStatusError:
		c.JSON(e.StatusCode, gin.H{
			"error":       e.Error(),
			"status_code": e.StatusCode,
		})
	case *telnyx.APIConnectionError:
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Network error connecting to Telnyx",
		})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": fmt.Sprintf("Internal server error: %v", err),
		})
	}
}

func main() {
	config, err := LoadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	router := gin.Default()

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	})

	// Provision eSIM endpoint
	router.POST("/esim/provision", func(c *gin.Context) {
		var req ProvisioningRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid request: %v", err)})
			return
		}

		resp, err := ProvisionESIM(config.TelnyxClient, &req)
		if err != nil {
			handleTelnyxError(c, err)
			return
		}

		c.JSON(http.StatusCreated, resp)
	})

	// Get eSIM status endpoint
	router.GET("/esim/:sim_card_id/status", func(c *gin.Context) {
		simCardID := c.Param("sim_card_id")
		if simCardID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "sim_card_id parameter required"})
			return
		}

		resp, err := GetESIMStatus(config.TelnyxClient, simCardID)
		if err != nil {
			handleTelnyxError(c, err)
			return
		}

		c.JSON(http.StatusOK, resp)
	})

	// Activate eSIM endpoint
	router.POST("/esim/:sim_card_id/activate", func(c *gin.Context) {
		simCardID := c.Param("sim_card_id")
		if simCardID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "sim_card_id parameter required"})
			return
		}

		resp, err := ActivateESIM(config.TelnyxClient, simCardID)
		if err != nil {
			handleTelnyxError(c, err)
			return
		}

		c.JSON(http.StatusOK, resp)
	})

	addr := fmt.Sprintf(":%s", config.Port)
	log.Printf("Starting eSIM provisioning server on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
