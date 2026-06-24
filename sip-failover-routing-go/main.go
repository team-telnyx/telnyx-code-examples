package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4"
	"github.com/team-telnyx/telnyx-go/v4/v2"
)

// Config holds application configuration
type Config struct {
	APIKey           string
	PrimaryEndpoint  SIPEndpoint
	BackupEndpoint   SIPEndpoint
	PhoneNumber      string
	HealthCheckURL   string
}

// SIPEndpoint represents a SIP server endpoint
type SIPEndpoint struct {
	IP   string
	Port int
	Name string
}

// SIPConnectionManager manages SIP connections and failover logic
type SIPConnectionManager struct {
	client           *telnyx.Client
	primaryConnID    string
	backupConnID     string
	activeConnID     string
	mu               sync.RWMutex
	primaryHealthy   bool
	backupHealthy    bool
}

// LoadConfig loads configuration from environment variables
func LoadConfig() (*Config, error) {
	_ = godotenv.Load()

	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("TELNYX_API_KEY environment variable not set")
	}

	primaryIP := os.Getenv("PRIMARY_SIP_IP")
	if primaryIP == "" {
		return nil, fmt.Errorf("PRIMARY_SIP_IP environment variable not set")
	}

	backupIP := os.Getenv("BACKUP_SIP_IP")
	if backupIP == "" {
		return nil, fmt.Errorf("BACKUP_SIP_IP environment variable not set")
	}

	phoneNumber := os.Getenv("TELNYX_PHONE_NUMBER")
	if phoneNumber == "" {
		return nil, fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}

	return &Config{
		APIKey: apiKey,
		PrimaryEndpoint: SIPEndpoint{
			IP:   primaryIP,
			Port: 5060,
			Name: "primary",
		},
		BackupEndpoint: SIPEndpoint{
			IP:   backupIP,
			Port: 5060,
			Name: "backup",
		},
		PhoneNumber:    phoneNumber,
		HealthCheckURL: "http://localhost:8080/health",
	}, nil
}

// NewSIPConnectionManager creates a new SIP connection manager
func NewSIPConnectionManager(apiKey string) *SIPConnectionManager {
	return &SIPConnectionManager{
		client:         telnyx.NewClient(option.WithAPIKey(apiKey)),
		primaryHealthy: true,
		backupHealthy:  true,
	}
}

// CreateSIPConnections creates primary and backup SIP connections
func (m *SIPConnectionManager) CreateSIPConnections(config *Config) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Create primary SIP connection
	primaryParams := &v2.SipConnectionCreateParams{
		ConnectionName: "primary-sip-connection",
		OutboundVoiceProfile: &v2.OutboundVoiceProfileCreateEmbeddedParams{
			Name: "primary-voice-profile",
		},
		SipAuthenticationCredentials: &v2.SipAuthenticationCredentialsParams{
			Username: "primary_user",
			Password: "primary_secure_password",
		},
		SipAddresses: []*v2.SipAddressParams{
			{
				Address: config.PrimaryEndpoint.IP,
				Port:    int32(config.PrimaryEndpoint.Port),
				Enabled: true,
			},
		},
	}

	primaryResp, err := m.client.SipConnections.Create(primaryParams)
	if err != nil {
		return fmt.Errorf("failed to create primary SIP connection: %w", err)
	}
	m.primaryConnID = primaryResp.Data.ID
	m.activeConnID = m.primaryConnID
	log.Printf("Created primary SIP connection: %s", m.primaryConnID)

	// Create backup SIP connection
	backupParams := &v2.SipConnectionCreateParams{
		ConnectionName: "backup-sip-connection",
		OutboundVoiceProfile: &v2.OutboundVoiceProfileCreateEmbeddedParams{
			Name: "backup-voice-profile",
		},
		SipAuthenticationCredentials: &v2.SipAuthenticationCredentialsParams{
			Username: "backup_user",
			Password: "backup_secure_password",
		},
		SipAddresses: []*v2.SipAddressParams{
			{
				Address: config.BackupEndpoint.IP,
				Port:    int32(config.BackupEndpoint.Port),
				Enabled: true,
			},
		},
	}

	backupResp, err := m.client.SipConnections.Create(backupParams)
	if err != nil {
		return fmt.Errorf("failed to create backup SIP connection: %w", err)
	}
	m.backupConnID = backupResp.Data.ID
	log.Printf("Created backup SIP connection: %s", m.backupConnID)

	return nil
}

// GetActiveConnection returns the currently active SIP connection ID
func (m *SIPConnectionManager) GetActiveConnection() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.activeConnID
}

// FailoverToBackup switches routing to the backup SIP connection
func (m *SIPConnectionManager) FailoverToBackup() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.activeConnID == m.backupConnID {
		return fmt.Errorf("already using backup connection")
	}

	m.activeConnID = m.backupConnID
	m.primaryHealthy = false
	log.Printf("Failover triggered: switched to backup SIP connection %s", m.backupConnID)
	return nil
}

// FailbackToPrimary switches routing back to the primary SIP connection
func (m *SIPConnectionManager) FailbackToPrimary() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.activeConnID == m.primaryConnID {
		return fmt.Errorf("already using primary connection")
	}

	m.activeConnID = m.primaryConnID
	m.primaryHealthy = true
	log.Printf("Failback triggered: switched to primary SIP connection %s", m.primaryConnID)
	return nil
}

// ListSIPConnections retrieves all SIP connections
func (m *SIPConnectionManager) ListSIPConnections() ([]map[string]interface{}, error) {
	resp, err := m.client.SipConnections.List()
	if err != nil {
		return nil, fmt.Errorf("failed to list SIP connections: %w", err)
	}

	var connections []map[string]interface{}
	for _, conn := range resp.Data {
		connections = append(connections, map[string]interface{}{
			"id":         conn.ID,
			"name":       conn.ConnectionName,
			"active":     conn.Active,
			"created_at": conn.CreatedAt,
		})
	}
	return connections, nil
}

// GetSIPConnection retrieves details of a specific SIP connection
func (m *SIPConnectionManager) GetSIPConnection(connectionID string) (map[string]interface{}, error) {
	resp, err := m.client.SipConnections.Retrieve(connectionID)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve SIP connection: %w", err)
	}

	return map[string]interface{}{
		"id":         resp.Data.ID,
		"name":       resp.Data.ConnectionName,
		"active":     resp.Data.Active,
		"created_at": resp.Data.CreatedAt,
	}, nil
}

// handleSIPError maps Telnyx SDK errors to HTTP status codes
func handleSIPError(c *gin.Context, err error) {
	switch err.(type) {
	case *telnyx.AuthenticationError:
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
	case *telnyx.RateLimitError:
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
	case *telnyx.APIStatusError:
		apiErr := err.(*telnyx.APIStatusError)
		c.JSON(apiErr.StatusCode, gin.H{"error": err.Error()})
	case *telnyx.APIConnectionError:
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

var sipManager *SIPConnectionManager

func init() {
	config, err := LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	sipManager = NewSIPConnectionManager(config.APIKey)

	if err := sipManager.CreateSIPConnections(config); err != nil {
		log.Fatalf("Failed to create SIP connections: %v", err)
	}
}

func main() {
	router := gin.Default()

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":             "healthy",
			"active_connection":  sipManager.GetActiveConnection(),
		})
	})

	// List all SIP connections
	router.GET("/sip/connections", func(c *gin.Context) {
		connections, err := sipManager.ListSIPConnections()
		if err != nil {
			handleSIPError(c, err)
			return
		}
		c.JSON(http.StatusOK, connections)
	})

	// Get specific SIP connection details
	router.GET("/sip/connections/:id", func(c *gin.Context) {
		connectionID := c.Param("id")
		connection, err := sipManager.GetSIPConnection(connectionID)
		if err != nil {
			handleSIPError(c, err)
			return
		}
		c.JSON(http.StatusOK, connection)
	})

	// Trigger failover to backup connection
	router.POST("/sip/failover", func(c *gin.Context) {
		if err := sipManager.FailoverToBackup(); err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"message":            "Failover to backup connection successful",
			"active_connection":  sipManager.GetActiveConnection(),
		})
	})

	// Trigger failback to primary connection
	router.POST("/sip/failback", func(c *gin.Context) {
		if err := sipManager.FailbackToPrimary(); err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"message":            "Failback to primary connection successful",
			"active_connection":  sipManager.GetActiveConnection(),
		})
	})

	// Get current routing status
	router.GET("/sip/status", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"active_connection": sipManager.GetActiveConnection(),
			"timestamp":         time.Now().Unix(),
		})
	})

	log.Println("Starting SIP failover routing server on :8080")
	if err := router.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
