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

// SIPConnectionResponse represents a serialized credential SIP connection for JSON
// responses. A Telnyx credential connection authenticates with a username/password
// rather than fixed SIP endpoint IPs, so the response exposes the real
// CredentialConnection fields returned by the v4 API.
type SIPConnectionResponse struct {
	ID             string `json:"id"`
	ConnectionName string `json:"connection_name"`
	UserName       string `json:"user_name"`
	Active         bool   `json:"active"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
}

// toSIPConnectionResponse maps a v4 CredentialConnection to the serializable response.
func toSIPConnectionResponse(conn telnyx.CredentialConnection) SIPConnectionResponse {
	return SIPConnectionResponse{
		ID:             conn.ID,
		ConnectionName: conn.ConnectionName,
		UserName:       conn.UserName,
		Active:         conn.Active,
		CreatedAt:      conn.CreatedAt,
		UpdatedAt:      conn.UpdatedAt,
	}
}

var client *telnyx.Client

func init() {
	config := LoadConfig()
	if config.TelnyxAPIKey == "" {
		fmt.Fprintf(os.Stderr, "Error: TELNYX_API_KEY environment variable not set\n")
		os.Exit(1)
	}
	// NewClient returns a value Client; take its address to share a single
	// client across handlers.
	clientValue := telnyx.NewClient(option.WithAPIKey(config.TelnyxAPIKey))
	client = &clientValue
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

	// Create the credential SIP connection via the Telnyx API. Credential
	// connections authenticate with a connection name plus username/password.
	params := telnyx.CredentialConnectionNewParams{
		ConnectionName: req.Name,
		UserName:       req.Username,
		Password:       req.Password,
	}

	response, err := client.CredentialConnections.New(context.Background(), params)
	if err != nil {
		handleTelnyxError(c, err)
		return
	}

	// Extract serializable data from the SDK response.
	result := toSIPConnectionResponse(response.Data)

	c.JSON(http.StatusCreated, result)
}

// listSIPConnections handles GET /sip-connections to list all SIP trunks.
func listSIPConnections(c *gin.Context) {
	response, err := client.CredentialConnections.List(context.Background(), telnyx.CredentialConnectionListParams{})
	if err != nil {
		handleTelnyxError(c, err)
		return
	}

	// Extract serializable data from the SDK response list.
	connections := make([]SIPConnectionResponse, 0, len(response.Data))
	for _, conn := range response.Data {
		connections = append(connections, toSIPConnectionResponse(conn))
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

	response, err := client.CredentialConnections.Get(context.Background(), connectionID)
	if err != nil {
		handleTelnyxError(c, err)
		return
	}

	// Extract serializable data from the SDK response.
	result := toSIPConnectionResponse(response.Data)

	c.JSON(http.StatusOK, result)
}

// handleTelnyxError maps Telnyx SDK errors to HTTP status codes.
func handleTelnyxError(c *gin.Context, err error) {
	var apiErr *telnyx.Error
	if errors.As(err, &apiErr) {
		c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error(), "status_code": apiErr.StatusCode})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
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
