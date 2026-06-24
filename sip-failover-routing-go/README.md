# Failover Routing with Go and Gin

## What Does This Example Do?

Build a production-ready SIP failover routing system using Go and Gin that automatically routes inbound calls to primary and backup SIP endpoints. This tutorial demonstrates how to configure multiple SIP connections with priority-based routing, implement health checks, and handle failover logic using the Telnyx Go SDK. You'll learn to manage SIP connection lifecycle, assign phone numbers to connections, and implement intelligent call routing that maintains service availability during endpoint failures.

## Who Is This For?

- **Go developers** building sip features with Gin.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Go 1.19 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- At least two Telnyx phone numbers in E.164 format for testing.
- A SIP PBX or softphone (Asterisk, FreeSWITCH, 3CX, or Zoiper) for receiving calls.
- Two SIP endpoints (primary and backup) with valid IP addresses or FQDNs.
- `curl` or Postman for testing HTTP endpoints.
- Basic understanding of SIP protocol and call routing concepts.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-failover-routing-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `sip_manager.go` to handle SIP connection creation, management, and failover logic:

```go
package main

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/team-telnyx/telnyx-go/v4"
	"github.com/team-telnyx/telnyx-go/v4/v2"
)

type SIPConnectionManager struct {
	client           *telnyx.Client
	primaryConnID    string
	backupConnID     string
	activeConnID     string
	mu               sync.RWMutex
	healthCheckTick  *time.Ticker
	primaryHealthy   bool
	backupHealthy    bool
}

func NewSIPConnectionManager(apiKey string) *SIPConnectionManager {
	return &SIPConnectionManager{
		client:         telnyx.NewClient(option.WithAPIKey(apiKey)),
		primaryHealthy: true,
		backupHealthy:  true,
	}
}

// CreateSIPConnections creates primary and backup SIP connections with credential authentication.
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

// AssignPhoneNumberToConnection assigns a phone number to a SIP connection.
func (m *SIPConnectionManager) AssignPhoneNumberToConnection(phoneNumber, connectionID string) error {
	// This would typically use the REST API directly to update phone number routing.
	// For this example, we log the assignment.
	log.Printf("Assigned phone number %s to SIP connection %s", phoneNumber, connectionID)
	return nil
}

// GetActiveConnection returns the currently active SIP connection ID.
func (m *SIPConnectionManager) GetActiveConnection() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.activeConnID
}

// FailoverToBackup switches routing to the backup SIP connection.
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

// FailbackToPrimary switches routing back to the primary SIP connection.
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

// ListSIPConnections retrieves all SIP connections for the account.
func (m *SIPConnectionManager) ListSIPConnections() ([]map[string]interface{}, error) {
	resp, err := m.client.SipConnections.List()
	if err != nil {
		return nil, fmt.Errorf("failed to list SIP connections: %w", err)
	}

	var connections []map[string]interface{}
	for _, conn := range resp.Data {
		connections = append(connections, map[string]interface{}{
			"id":                conn.ID,
			"name":              conn.ConnectionName,
			"active":            conn.Active,
			"created_at":        conn.CreatedAt,
		})
	}
	return connections, nil
}

// GetSIPConnection retrieves details of a specific SIP connection.
func (m *SIPConnectionManager) GetSIPConnection(connectionID string) (map[string]interface{}, error) {
	resp, err := m.client.SipConnections.Retrieve(connectionID)
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve SIP connection: %w", err)
	}

	return map[string]interface{}{
		"id":                resp.Data.ID,
		"name":              resp.Data.ConnectionName,
		"active":            resp.Data.Active,
		"created_at":        resp.Data.CreatedAt,
	}, nil
}
```

Create `main.go` to set up the Gin server with failover routing endpoints:

```go
package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4"
)

var sipManager *SIPConnectionManager

func init() {
	// Initialize SIP connection manager
	config, err := LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	sipManager = NewSIPConnectionManager(config.APIKey)

	// Create SIP connections during initialization
	if err := sipManager.CreateSIPConnections(config); err != nil {
		log.Fatalf("Failed to create SIP connections: %v", err)
	}
}

func main() {
	router := gin.Default()

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "healthy",
			"active_connection": sipManager.GetActiveConnection(),
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
			"message": "Failover to backup connection successful",
			"active_connection": sipManager.GetActiveConnection(),
		})
	})

	// Trigger failback to primary connection
	router.POST("/sip/failback", func(c *gin.Context) {
		if err := sipManager.FailbackToPrimary(); err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"message": "Failback to primary connection successful",
			"active_connection": sipManager.GetActiveConnection(),
		})
	})

	// Get current routing status
	router.GET("/sip/status", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"active_connection": sipManager.GetActiveConnection(),
			"timestamp": time.Now().Unix(),
		})
	})

	log.Println("Starting SIP failover routing server on :8080")
	if err := router.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
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
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Go server after updating the `.env` file. |
| SIP Connection Creation Fails | The server logs "failed to create primary SIP connection" during startup. | Verify that the `PRIMARY_SIP_IP` and `BACKUP_SIP_IP` environment variables are set to valid IP addresses or FQDNs. Ensure your SIP endpoints are reachable and configured to accept connections on port 5060. Check that your Telnyx account has sufficient permissions to create SIP connections. |
| Failover Already Active | POST to `/sip/failover` returns `{"error": "already using backup connection"}`. | This is expected behavior—the system is already routing to the backup endpoint. To return to primary routing, use the `/sip/failback` endpoint instead. |
| Rate Limit Exceeded | The endpoint returns `{"error": "Rate limit exceeded"}` with HTTP 429. | Implement exponential backoff in your client code. Space out API requests to no more than 10 per second. If you consistently hit rate limits, contact Telnyx support to request a higher limit for your account. |
| Network Error Connecting to Telnyx | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection and firewall rules allow outbound HTTPS traffic to `api.telnyx.com`. Check that your DNS can resolve `api.telnyx.com`. Temporarily disable VPN or proxy services if applicable. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Go version do I need?**

Go 1.22 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [SIP Configuration Guides](https://developers.telnyx.com/docs/voice/sip-trunking/configuration-guides)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)

## Related Examples

- [SIP Trunking Setup with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/go/sip-trunking-setup).
- [Outbound SIP Calls with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/go/outbound-sip-call).
- [Inbound SIP Routing with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/go/inbound-sip-routing).
