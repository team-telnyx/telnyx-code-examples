package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2/messaging"
)

// Config holds application configuration
type Config struct {
	TelnyxAPIKey   string
	TelnyxPhoneNum string
	WebhookSecret  string
	Port           string
}

// LoadConfig loads environment variables into Config
func LoadConfig() *Config {
	_ = godotenv.Load()

	return &Config{
		TelnyxAPIKey:   os.Getenv("TELNYX_API_KEY"),
		TelnyxPhoneNum: os.Getenv("TELNYX_PHONE_NUMBER"),
		WebhookSecret:  os.Getenv("WEBHOOK_SECRET"),
		Port:           getEnvOrDefault("PORT", "8080"),
	}
}

func getEnvOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

// InboundMessage represents the webhook payload structure
type InboundMessage struct {
	Data struct {
		ID         string `json:"id"`
		Direction  string `json:"direction"`
		From       string `json:"from"`
		To         string `json:"to"`
		Text       string `json:"text"`
		ReceivedAt string `json:"received_at"`
	} `json:"data"`
	Meta struct {
		EventType string `json:"event_type"`
	} `json:"meta"`
}

var client *telnyx.Client
var cfg *Config

func init() {
	cfg = LoadConfig()

	if cfg.TelnyxAPIKey == "" {
		log.Fatal("TELNYX_API_KEY environment variable not set")
	}
	if cfg.TelnyxPhoneNum == "" {
		log.Fatal("TELNYX_PHONE_NUMBER environment variable not set")
	}

	client = telnyx.NewClient(telnyx.WithAPIKey(cfg.TelnyxAPIKey))
}

func main() {
	router := gin.Default()

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	router.POST("/webhooks/sms", handleInboundSMS)

	addr := ":" + cfg.Port
	log.Printf("Starting SMS autoresponder on %s\n", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Server error: %v\n", err)
	}
}

func handleInboundSMS(c *gin.Context) {
	var msg InboundMessage

	if err := c.ShouldBindJSON(&msg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if msg.Meta.EventType != "message.received" {
		c.JSON(http.StatusOK, gin.H{"message": "Event type not processed"})
		return
	}

	if msg.Data.From == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing sender phone number"})
		return
	}

	log.Printf("Inbound SMS from %s: %s\n", msg.Data.From, msg.Data.Text)

	go sendAutoresponse(msg.Data.From, msg.Data.Text)

	c.JSON(http.StatusOK, gin.H{"status": "received"})
}

func sendAutoresponse(senderNumber, inboundText string) {
	autoresponseText := fmt.Sprintf(
		"Thank you for your message: \"%s\". We'll get back to you shortly!",
		inboundText,
	)

	params := &messaging.MessageCreateParams{
		From: cfg.TelnyxPhoneNum,
		To:   senderNumber,
		Text: autoresponseText,
	}

	response, err := client.Messages.Create(params)
	if err != nil {
		logSendError(senderNumber, err)
		return
	}

	if response != nil && response.Data != nil {
		log.Printf(
			"Autoresponse sent: ID=%s, To=%s, Status=%s\n",
			response.Data.ID,
			senderNumber,
			response.Data.To[0].Status,
		)
	}
}

func logSendError(recipient string, err error) {
	switch e := err.(type) {
	case *telnyx.AuthenticationError:
		log.Printf("Auth error sending to %s: invalid API key\n", recipient)
	case *telnyx.RateLimitError:
		log.Printf("Rate limit error sending to %s: slow down\n", recipient)
	case *telnyx.APIStatusError:
		log.Printf("API error sending to %s: status=%d, message=%s\n", recipient, e.Status, e.Message)
	case *telnyx.APIConnectionError:
		log.Printf("Connection error sending to %s: %v\n", recipient, e)
	default:
		log.Printf("Error sending autoresponse to %s: %v\n", recipient, err)
	}
}
