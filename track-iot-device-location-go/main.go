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

// Config holds application configuration.
type Config struct {
	APIKey string
}

// LoadConfig reads environment variables and returns a Config struct.
func LoadConfig() *Config {
	_ = godotenv.Load()

	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		log.Fatal("TELNYX_API_KEY environment variable not set")
	}

	return &Config{
		APIKey: apiKey,
	}
}

// NewTelnyxClient initializes the Telnyx SDK client with the new pattern.
func NewTelnyxClient(cfg *Config) *telnyx.Client {
	return telnyx.NewClient(option.WithAPIKey(cfg.APIKey))
}

// DeviceLocation represents a device's location information derived from SIM card data.
type DeviceLocation struct {
	SimCardID       string `json:"sim_card_id"`
	ICCID           string `json:"iccid"`
	Status          string `json:"status"`
	NetworkOperator string `json:"network_operator"`
	IsAttached      bool   `json:"is_attached"`
	LastUpdated     string `json:"last_updated"`
}

// GetDeviceLocation retrieves location information for a specific SIM card.
func GetDeviceLocation(client *telnyx.Client, simCardID string) (*DeviceLocation, error) {
	response, err := client.SimCards.Retrieve(simCardID)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve SIM card: %w", err)
	}

	simCard := response.Data

	isAttached := simCard.Status == "active"

	networkOperator := "unknown"
	if simCard.NetworkOperator != nil {
		networkOperator = *simCard.NetworkOperator
	}

	location := &DeviceLocation{
		SimCardID:       simCard.ID,
		ICCID:           simCard.ICCID,
		Status:          simCard.Status,
		NetworkOperator: networkOperator,
		IsAttached:      isAttached,
		LastUpdated:     simCard.UpdatedAt.String(),
	}

	return location, nil
}

// ListDeviceLocations retrieves location information for all SIM cards in the account.
func ListDeviceLocations(client *telnyx.Client) ([]DeviceLocation, error) {
	response, err := client.SimCards.List()
	if err != nil {
		return nil, fmt.Errorf("failed to list SIM cards: %w", err)
	}

	var locations []DeviceLocation

	for _, simCard := range response.Data {
		isAttached := simCard.Status == "active"
		networkOperator := "unknown"
		if simCard.NetworkOperator != nil {
			networkOperator = *simCard.NetworkOperator
		}

		location := DeviceLocation{
			SimCardID:       simCard.ID,
			ICCID:           simCard.ICCID,
			Status:          simCard.Status,
			NetworkOperator: networkOperator,
			IsAttached:      isAttached,
			LastUpdated:     simCard.UpdatedAt.String(),
		}

		locations = append(locations, location)
	}

	return locations, nil
}

// DeviceLocationHandler holds dependencies for HTTP handlers.
type DeviceLocationHandler struct {
	client *telnyx.Client
}

// NewDeviceLocationHandler creates a new handler with a Telnyx client.
func NewDeviceLocationHandler(client *telnyx.Client) *DeviceLocationHandler {
	return &DeviceLocationHandler{
		client: client,
	}
}

// GetDeviceLocation handles GET /devices/:sim_card_id requests.
func (h *DeviceLocationHandler) GetDeviceLocation(c *gin.Context) {
	simCardID := c.Param("sim_card_id")

	if simCardID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sim_card_id parameter required"})
		return
	}

	location, err := GetDeviceLocation(h.client, simCardID)

	if err != nil {
		switch err.(type) {
		case *telnyx.AuthenticationError:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
		case *telnyx.RateLimitError:
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
		case *telnyx.APIStatusError:
			apiErr := err.(*telnyx.APIStatusError)
			c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error()})
		case *telnyx.APIConnectionError:
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, location)
}

// ListDeviceLocations handles GET /devices requests.
func (h *DeviceLocationHandler) ListDeviceLocations(c *gin.Context) {
	locations, err := ListDeviceLocations(h.client)

	if err != nil {
		switch err.(type) {
		case *telnyx.AuthenticationError:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
		case *telnyx.RateLimitError:
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
		case *telnyx.APIStatusError:
			apiErr := err.(*telnyx.APIStatusError)
			c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error()})
		case *telnyx.APIConnectionError:
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"devices": locations})
}

// HealthCheck handles GET /health requests.
func (h *DeviceLocationHandler) HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "healthy"})
}

func main() {
	cfg := LoadConfig()
	client := NewTelnyxClient(cfg)

	router := gin.Default()
	handler := NewDeviceLocationHandler(client)

	router.GET("/health", handler.HealthCheck)
	router.GET("/devices", handler.ListDeviceLocations)
	router.GET("/devices/:sim_card_id", handler.GetDeviceLocation)

	log.Println("Starting device location service on :8080")
	if err := router.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
