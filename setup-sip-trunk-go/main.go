package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2"
)

// Config holds environment configuration.
type Config struct {
	TelnyxAPIKey    string
	SIPEndpointIP   string
	SIPEndpointPort string
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() *Config {
	_ = godotenv.Load()
	return &Config{
		TelnyxAPIKey:    os.Getenv("TELNYX_API_KEY"),
		SIPEndpointIP:   os.Getenv("SIP_ENDPOINT_IP"),
		SIPEndpointPort: os.Getenv("SIP_ENDPOINT_PORT"),
	}
}

// CreateSIPConnectionRequest represents the request body for creating a SIP connection.
type CreateSIPConnectionRequest struct {
	Name                 string `json:"name" binding:"required"`
	Username             string `json:"username" binding:"required"`
	Password             string `json:"password" binding:"required"`
	SIPEndpointIP        string `json:"sip_endpoint_ip" binding:"required"`
	SIPEndpointPort      int    `json:"sip_endpoint_port" binding:"required"`
	OutboundVoiceProfile string `json:"outbound_voice_profile_id"`
}

// SIPConnectionResponse represents a serialized SIP connection for JSON responses.
type SIPConnectionResponse struct {
	ID                   string `json:"id"`
	Name                 string `json:"name"`
	Username             string `json:"username"`
	SIPEndpointIP        string `json:"sip_endpoint_ip"`
	SIPEndpointPort      int    `json:"sip_endpoint_port"`
	OutboundVoiceProfile string `json:"outbound_voice_profile_id"`
	CreatedAt            string `json:"created_at"`
}

var client *telnyx.Client

func init() {
	config := LoadConfig()
	if config.TelnyxAPIKey == "" {
		fmt.Fprintf(os.Stderr, "Error: TELNYX_API_KEY environment variable not set\n")
		os.Exit(1)
	}
	client = telnyx.NewClient(option.WithAPIKey(config.TelnyxAPIKey))
}

// createSIPConnection handles POST /sip-connections to create a new SIP trunk.
func createSIPConnection(c *gin.Context) {
	var req CreateSIPConnectionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate SIP endpoint port range.
	if req.SIPEndpointPort < 1 || req.SIPEndpointPort > 65535 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "SIP endpoint port must be between 1 and 65535"})
		return
	}

	// Create SIP connection via Telnyx API.
	params := &telnyx.SIPConnectionCreateParams{
		ConnectionName: req.Name,
		Credentials: &telnyx.SIPConnectionCredentials{
			Username: req.Username,
			Password: req.Password,
		},
		SIPEndpoints: []*telnyx.SIPEndpoint{
			{
				Address: req.SIPEndpointIP,
				Port:    req.SIPEndpointPort,
				Enabled: true,
			},
		},
	}

	if req.OutboundVoiceProfile != "" {
		params.OutboundVoiceProfileID = req.OutboundVoiceProfile
	}

	response, err := client.SIPConnections.Create(params)
	if err != nil {
		handleTelnyxError(c, err)
		return
	}

	// Extract serializable data from SDK response.
	result := SIPConnectionResponse{
		ID:              response.Data.ID,
		Name:            response.Data.ConnectionName,
		Username:        response.Data.Credentials.Username,
		SIPEndpointIP:   response.Data.SIPEndpoints[0].Address,
		SIPEndpointPort: response.Data.SIPEndpoints[0].Port,
		CreatedAt:       response.Data.CreatedAt.String(),
	}

	if response.Data.OutboundVoiceProfileID != "" {
		result.OutboundVoiceProfile = response.Data.OutboundVoiceProfileID
	}

	c.JSON(http.StatusCreated, result)
}

// listSIPConnections handles GET /sip-connections to list all SIP trunks.
func listSIPConnections(c *gin.Context) {
	response, err := client.SIPConnections.List(&telnyx.SIPConnectionListParams{})
	if err != nil {
		handleTelnyxError(c, err)
		return
	}

	// Extract serializable data from SDK response list.
	var connections []SIPConnectionResponse
	for _, conn := range response.Data {
		sip := SIPConnectionResponse{
			ID:        conn.ID,
			Name:      conn.ConnectionName,
			Username:  conn.Credentials.Username,
			CreatedAt: conn.CreatedAt.String(),
		}

		if len(conn.SIPEndpoints) > 0 {
			sip.SIPEndpointIP = conn.SIPEndpoints[0].Address
			sip.SIPEndpointPort = conn.SIPEndpoints[0].Port
		}

		if conn.OutboundVoiceProfileID != "" {
			sip.OutboundVoiceProfile = conn.OutboundVoiceProfileID
		}

		connections = append(connections, sip)
	}

	c.JSON(http.StatusOK, connections)
}

// getSIPConnection handles GET /sip-connections/:id to retrieve a specific SIP trunk.
func getSIPConnection(c *gin.Context) {
	connectionID := c.Param("id")
	if connectionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Connection ID required"})
		return
	}

	response, err := client.SIPConnections.Retrieve(connectionID)
	if err != nil {
		handleTelnyxError(c, err)
		return
	}

	// Extract serializable data from SDK response.
	result := SIPConnectionResponse{
		ID:        response.Data.ID,
		Name:      response.Data.ConnectionName,
		Username:  response.Data.Credentials.Username,
		CreatedAt: response.Data.CreatedAt.String(),
	}

	if len(response.Data.SIPEndpoints) > 0 {
		result.SIPEndpointIP = response.Data.SIPEndpoints[0].Address
		result.SIPEndpointPort = response.Data.SIPEndpoints[0].Port
	}

	if response.Data.OutboundVoiceProfileID != "" {
		result.OutboundVoiceProfile = response.Data.OutboundVoiceProfileID
	}

	c.JSON(http.StatusOK, result)
}

// handleTelnyxError maps Telnyx SDK errors to HTTP status codes.
func handleTelnyxError(c *gin.Context, err error) {
	switch e := err.(type) {
	case *telnyx.AuthenticationError:
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
	case *telnyx.RateLimitError:
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
	case *telnyx.APIStatusError:
		c.JSON(e.StatusCode, gin.H{"error": e.Error(), "status_code": e.StatusCode})
	case *telnyx.APIConnectionError:
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
	}
}

func main() {
	router := gin.Default()

	// SIP connection routes.
	router.POST("/sip-connections", createSIPConnection)
	router.GET("/sip-connections", listSIPConnections)
	router.GET("/sip-connections/:id", getSIPConnection)

	// Health check endpoint.
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	fmt.Println("Starting SIP Trunking API on :8080")
	if err := router.Run(":8080"); err != nil {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}
