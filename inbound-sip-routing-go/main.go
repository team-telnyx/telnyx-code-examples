package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2/option"
)

// Config holds application configuration.
type Config struct {
	TelnyxAPIKey   string
	TelnyxPhoneNum string
	WebhookURL     string
	ServerPort     string
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() *Config {
	_ = godotenv.Load()

	return &Config{
		TelnyxAPIKey:   os.Getenv("TELNYX_API_KEY"),
		TelnyxPhoneNum: os.Getenv("TELNYX_PHONE_NUMBER"),
		WebhookURL:     os.Getenv("WEBHOOK_URL"),
		ServerPort:     getEnvOrDefault("SERVER_PORT", "8080"),
	}
}

func getEnvOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

// SIPConnectionRequest represents the payload for creating a SIP connection.
type SIPConnectionRequest struct {
	Name             string   `json:"name" binding:"required"`
	InboundAddresses []string `json:"inbound_addresses" binding:"required"`
	Username         string   `json:"username" binding:"required"`
	Password         string   `json:"password" binding:"required"`
}

// IncomingCallWebhook represents the webhook payload for incoming calls.
type IncomingCallWebhook struct {
	Data struct {
		EventType string `json:"event_type"`
		Payload   struct {
			CallSessionID string `json:"call_session_id"`
			From          string `json:"from"`
			To            string `json:"to"`
			State         string `json:"state"`
		} `json:"payload"`
	} `json:"data"`
}

// CallRoutingRequest represents a request to route an incoming call.
type CallRoutingRequest struct {
	CallSessionID string `json:"call_session_id" binding:"required"`
	RouteTo       string `json:"route_to" binding:"required"`
}

// CreateSIPConnection creates a new SIP connection via the Telnyx API.
func CreateSIPConnection(client *telnyx.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req SIPConnectionRequest

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
			return
		}

		if len(req.InboundAddresses) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "At least one inbound address is required"})
			return
		}

		// In production, use the actual SDK method to create SIP connection.
		// For this example, we return a mock response.
		result := gin.H{
			"id":                "sip_conn_123456",
			"name":              req.Name,
			"username":          req.Username,
			"inbound_addresses": req.InboundAddresses,
			"created_at":        "2026-06-24T10:30:00Z",
		}

		c.JSON(http.StatusCreated, result)
	}
}

// ListSIPConnections retrieves all SIP connections.
func ListSIPConnections(client *telnyx.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		// In production, fetch from Telnyx API.
		connections := []map[string]interface{}{
			{
				"id":                "sip_conn_123456",
				"name":              "Office PBX",
				"username":          "office_pbx",
				"inbound_addresses": []string{"203.0.113.10"},
				"created_at":        "2026-06-24T10:30:00Z",
			},
		}

		c.JSON(http.StatusOK, gin.H{"connections": connections})
	}
}

// GetSIPConnection retrieves a specific SIP connection by ID.
func GetSIPConnection(client *telnyx.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		connectionID := c.Param("id")

		if connectionID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Connection ID is required"})
			return
		}

		// In production, fetch from Telnyx API.
		result := gin.H{
			"id":                connectionID,
			"name":              "Office PBX",
			"username":          "office_pbx",
			"inbound_addresses": []string{"203.0.113.10"},
			"created_at":        "2026-06-24T10:30:00Z",
		}

		c.JSON(http.StatusOK, result)
	}
}

// HandleIncomingCall processes incoming call webhooks from Telnyx.
func HandleIncomingCall() gin.HandlerFunc {
	return func(c *gin.Context) {
		var webhook IncomingCallWebhook

		if err := c.ShouldBindJSON(&webhook); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload: " + err.Error()})
			return
		}

		callSessionID := webhook.Data.Payload.CallSessionID
		from := webhook.Data.Payload.From
		to := webhook.Data.Payload.To
		state := webhook.Data.Payload.State

		if state == "initiated" {
			c.JSON(http.StatusOK, gin.H{
				"call_session_id": callSessionID,
				"from":            from,
				"to":              to,
				"status":          "received",
				"action":          "route_to_sip_endpoint",
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"call_session_id": callSessionID,
			"state":           state,
			"status":          "acknowledged",
		})
	}
}

// RouteCall routes an incoming call to a specified SIP endpoint.
func RouteCall() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CallRoutingRequest

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
			return
		}

		if req.RouteTo == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "route_to field is required"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"call_session_id": req.CallSessionID,
			"route_to":        req.RouteTo,
			"status":          "routed",
			"message":         "Call routing initiated",
		})
	}
}

func main() {
	cfg := LoadConfig()

	if cfg.TelnyxAPIKey == "" {
		log.Fatal("TELNYX_API_KEY environment variable is not set")
	}
	if cfg.TelnyxPhoneNum == "" {
		log.Fatal("TELNYX_PHONE_NUMBER environment variable is not set")
	}

	// Initialize Telnyx client with the new SDK pattern.
	client := telnyx.NewClient(option.WithAPIKey(cfg.TelnyxAPIKey))

	router := gin.Default()

	// Health check endpoint.
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// SIP connection management routes.
	router.POST("/sip/connections", CreateSIPConnection(client))
	router.GET("/sip/connections", ListSIPConnections(client))
	router.GET("/sip/connections/:id", GetSIPConnection(client))

	// Webhook routes for incoming calls.
	router.POST("/webhooks/call", HandleIncomingCall())
	router.POST("/webhooks/call/route", RouteCall())

	port := ":" + cfg.ServerPort
	log.Printf("Starting Gin server on %s\n", port)
	if err := router.Run(port); err != nil {
		log.Fatalf("Failed to start server: %v\n", err)
	}
}
