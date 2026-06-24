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
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2"
)

// Config holds application configuration.
type Config struct {
	APIKey       string
	PhoneNumber  string
	ConnectionID string
	WebhookURL   string
	Port         string
}

// ConferenceSession represents an active conference call.
type ConferenceSession struct {
	ConferenceID string   `json:"conference_id"`
	Participants []string `json:"participants"`
	Status       string   `json:"status"`
	CreatedAt    string   `json:"created_at"`
}

// CallInitRequest represents a request to initiate a call.
type CallInitRequest struct {
	To string `json:"to" binding:"required"`
}

// CallInitResponse represents the response after initiating a call.
type CallInitResponse struct {
	CallControlID string `json:"call_control_id"`
	Status        string `json:"status"`
}

// WebhookEvent represents an incoming webhook event from Telnyx.
type WebhookEvent struct {
	Data struct {
		EventType     string `json:"event_type"`
		CallControlID string `json:"call_control_id"`
		ConferenceID  string `json:"conference_id"`
		State         string `json:"state"`
		From          string `json:"from"`
		To            string `json:"to"`
	} `json:"data"`
}

// ConferenceManager tracks active conferences and participants.
type ConferenceManager struct {
	mu         sync.RWMutex
	sessions   map[string]*ConferenceSession
	callToConf map[string]string
}

var conferenceManager = &ConferenceManager{
	sessions:   make(map[string]*ConferenceSession),
	callToConf: make(map[string]string),
}

// LoadConfig loads and validates environment variables.
func LoadConfig() (*Config, error) {
	_ = godotenv.Load()

	cfg := &Config{
		APIKey:       os.Getenv("TELNYX_API_KEY"),
		PhoneNumber:  os.Getenv("TELNYX_PHONE_NUMBER"),
		ConnectionID: os.Getenv("TELNYX_CONNECTION_ID"),
		WebhookURL:   os.Getenv("WEBHOOK_URL"),
		Port:         os.Getenv("PORT"),
	}

	if cfg.Port == "" {
		cfg.Port = "8080"
	}

	if cfg.APIKey == "" {
		return nil, fmt.Errorf("TELNYX_API_KEY environment variable not set")
	}
	if cfg.PhoneNumber == "" {
		return nil, fmt.Errorf("TELNYX_PHONE_NUMBER environment variable not set")
	}
	if cfg.ConnectionID == "" {
		return nil, fmt.Errorf("TELNYX_CONNECTION_ID environment variable not set")
	}

	return cfg, nil
}

// InitiateCall initiates an outbound call and adds it to a conference.
func InitiateCall(cfg *Config, client *telnyx.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CallInitRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required field: 'to'"})
			return
		}

		if len(req.To) == 0 || req.To[0] != '+' {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number must be in E.164 format (e.g., +15551234567)"})
			return
		}

		conferenceID := fmt.Sprintf("conf_%d", time.Now().UnixNano())

		dialResponse, err := client.Calls.Dial(
			&v2.CallDialRequest{
				From:         cfg.PhoneNumber,
				To:           req.To,
				ConnectionID: cfg.ConnectionID,
			},
		)

		if err != nil {
			handleTelnyxError(c, err)
			return
		}

		callControlID := dialResponse.Data.CallControlID

		conferenceManager.mu.Lock()
		conferenceManager.callToConf[callControlID] = conferenceID

		if _, exists := conferenceManager.sessions[conferenceID]; !exists {
			conferenceManager.sessions[conferenceID] = &ConferenceSession{
				ConferenceID: conferenceID,
				Participants: []string{},
				Status:       "initiated",
				CreatedAt:    time.Now().Format(time.RFC3339),
			}
		}

		conferenceManager.sessions[conferenceID].Participants = append(
			conferenceManager.sessions[conferenceID].Participants,
			callControlID,
		)
		conferenceManager.mu.Unlock()

		c.JSON(http.StatusOK, CallInitResponse{
			CallControlID: callControlID,
			Status:        "initiated",
		})
	}
}

// GetConferenceStatus retrieves the status of an active conference.
func GetConferenceStatus(c *gin.Context) {
	conferenceID := c.Param("conference_id")

	conferenceManager.mu.RLock()
	session, exists := conferenceManager.sessions[conferenceID]
	conferenceManager.mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conference not found"})
		return
	}

	c.JSON(http.StatusOK, session)
}

// HandleWebhook processes incoming call events from Telnyx.
func HandleWebhook(c *gin.Context) {
	var event WebhookEvent
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	callControlID := event.Data.CallControlID
	eventType := event.Data.EventType

	conferenceManager.mu.Lock()
	defer conferenceManager.mu.Unlock()

	conferenceID, exists := conferenceManager.callToConf[callControlID]
	if !exists {
		c.JSON(http.StatusOK, gin.H{"status": "ignored"})
		return
	}

	session, sessionExists := conferenceManager.sessions[conferenceID]
	if !sessionExists {
		c.JSON(http.StatusOK, gin.H{"status": "ignored"})
		return
	}

	switch eventType {
	case "call.answered":
		session.Status = "active"

	case "call.hangup":
		for i, pid := range session.Participants {
			if pid == callControlID {
				session.Participants = append(session.Participants[:i], session.Participants[i+1:]...)
				break
			}
		}

		delete(conferenceManager.callToConf, callControlID)

		if len(session.Participants) == 0 {
			session.Status = "ended"
		}

	case "call.initiated":
		// No action needed yet

	default:
		// Ignore other event types
	}

	c.JSON(http.StatusOK, gin.H{"status": "processed"})
}

// handleTelnyxError maps Telnyx SDK errors to HTTP status codes.
func handleTelnyxError(c *gin.Context, err error) {
	switch err.(type) {
	case *telnyx.AuthenticationError:
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
	case *telnyx.RateLimitError:
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
	case *telnyx.APIStatusError:
		apiErr := err.(*telnyx.APIStatusError)
		c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.Error(), "status_code": apiErr.StatusCode})
	case *telnyx.APIConnectionError:
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
	}
}

func main() {
	cfg, err := LoadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	client := telnyx.NewClient(telnyx.WithAPIKey(cfg.APIKey))

	router := gin.Default()

	router.Use(func(c *gin.Context) {
		c.Set("telnyx_client", client)
		c.Set("config", cfg)
		c.Next()
	})

	router.POST("/calls/initiate", InitiateCall(cfg, client))
	router.GET("/conferences/:conference_id", GetConferenceStatus)
	router.POST("/webhooks/call", HandleWebhook)

	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("Starting server on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
