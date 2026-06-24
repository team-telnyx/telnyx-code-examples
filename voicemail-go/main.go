package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/team-telnyx/telnyx-go/v4/v2"
	"github.com/team-telnyx/telnyx-go/v4/v2/call"
)

// Config holds application configuration
type Config struct {
	APIKey       string
	PhoneNumber  string
	ConnectionID string
	WebhookURL   string
	Port         string
}

// LoadConfig loads and validates environment variables
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

// VoicemailService handles voicemail operations
type VoicemailService struct {
	client *telnyx.Client
	config *Config
}

// NewVoicemailService creates a new voicemail service
func NewVoicemailService(client *telnyx.Client, config *Config) *VoicemailService {
	return &VoicemailService{
		client: client,
		config: config,
	}
}

// AnswerCall answers an inbound call
func (vs *VoicemailService) AnswerCall(callControlID string) error {
	params := &call.AnswerParams{}
	_, err := vs.client.Calls.Answer(callControlID, params)
	if err != nil {
		log.Printf("Error answering call %s: %v", callControlID, err)
		return err
	}
	return nil
}

// PlayGreeting plays a TTS greeting message
func (vs *VoicemailService) PlayGreeting(callControlID string) error {
	params := &call.SpeakParams{
		Payload:  "Please leave your message after the beep. Press pound when finished.",
		Voice:    "female",
		Language: "en-US",
	}
	_, err := vs.client.Calls.Speak(callControlID, params)
	if err != nil {
		log.Printf("Error playing greeting for call %s: %v", callControlID, err)
		return err
	}
	return nil
}

// StartRecording begins recording the voicemail
func (vs *VoicemailService) StartRecording(callControlID string) error {
	params := &call.StartRecordingParams{
		Format: "wav",
	}
	_, err := vs.client.Calls.StartRecording(callControlID, params)
	if err != nil {
		log.Printf("Error starting recording for call %s: %v", callControlID, err)
		return err
	}
	return nil
}

// StopRecording stops the voicemail recording
func (vs *VoicemailService) StopRecording(callControlID string) error {
	params := &call.StopRecordingParams{}
	_, err := vs.client.Calls.StopRecording(callControlID, params)
	if err != nil {
		log.Printf("Error stopping recording for call %s: %v", callControlID, err)
		return err
	}
	return nil
}

// HangupCall terminates the call
func (vs *VoicemailService) HangupCall(callControlID string) error {
	params := &call.HangupParams{}
	_, err := vs.client.Calls.Hangup(callControlID, params)
	if err != nil {
		log.Printf("Error hanging up call %s: %v", callControlID, err)
		return err
	}
	return nil
}

// WebhookPayload represents the structure of incoming webhooks
type WebhookPayload struct {
	Data struct {
		EventType     string `json:"event_type"`
		CallControlID string `json:"call_control_id"`
		From          string `json:"from"`
		To            string `json:"to"`
		RecordingURL  string `json:"recording_urls"`
		State         string `json:"state"`
	} `json:"data"`
}

// CallInitRequest represents a request to initiate a call
type CallInitRequest struct {
	To string `json:"to" binding:"required"`
}

// HandleWebhook processes incoming call control webhooks
func HandleWebhook(vs *VoicemailService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var payload WebhookPayload
		if err := c.ShouldBindJSON(&payload); err != nil {
			log.Printf("Invalid webhook payload: %v", err)
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid payload"})
			return
		}

		callControlID := payload.Data.CallControlID
		eventType := payload.Data.EventType

		log.Printf("Received webhook: event_type=%s, call_control_id=%s", eventType, callControlID)

		switch eventType {
		case "call.initiated":
			if err := vs.AnswerCall(callControlID); err != nil {
				log.Printf("Failed to answer call: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to answer call"})
				return
			}

		case "call.answered":
			if err := vs.PlayGreeting(callControlID); err != nil {
				log.Printf("Failed to play greeting: %v", err)
			}
			if err := vs.StartRecording(callControlID); err != nil {
				log.Printf("Failed to start recording: %v", err)
			}

		case "call.dtmf.received":
			if err := vs.StopRecording(callControlID); err != nil {
				log.Printf("Failed to stop recording: %v", err)
			}
			if err := vs.HangupCall(callControlID); err != nil {
				log.Printf("Failed to hangup call: %v", err)
			}

		case "call.recording.saved":
			log.Printf("Recording saved for call %s: %s", callControlID, payload.Data.RecordingURL)

		case "call.hangup":
			log.Printf("Call %s ended", callControlID)

		default:
			log.Printf("Unhandled event type: %s", eventType)
		}

		c.JSON(http.StatusOK, gin.H{"status": "received"})
	}
}

// HandleInitiateCall initiates an outbound call
func HandleInitiateCall(vs *VoicemailService, config *Config) gin.HandlerFunc {
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

		client := telnyx.NewClient(telnyx.WithAPIKey(config.APIKey))

		dialParams := &telnyx.CallDialParams{
			From:         config.PhoneNumber,
			To:           req.To,
			ConnectionID: config.ConnectionID,
		}

		response, err := client.Calls.Dial(dialParams)
		if err != nil {
			handleCallError(c, err)
			return
		}

		result := map[string]interface{}{
			"call_control_id": response.Data.CallControlID,
			"from":            response.Data.From,
			"to":              response.Data.To,
			"state":           response.Data.State,
		}

		c.JSON(http.StatusOK, result)
	}
}

// handleCallError maps Telnyx SDK errors to HTTP status codes
func handleCallError(c *gin.Context, err error) {
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
	config, err := LoadConfig()
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	client := telnyx.NewClient(telnyx.WithAPIKey(config.APIKey))
	voicemailService := NewVoicemailService(client, config)

	router := gin.Default()

	router.POST("/webhooks/call", HandleWebhook(voicemailService))
	router.POST("/calls/initiate", HandleInitiateCall(voicemailService, config))
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	log.Printf("Starting voicemail server on port %s", config.Port)
	if err := router.Run(":" + config.Port); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
