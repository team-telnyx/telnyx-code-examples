package main

import (
	"crypto/rand"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go/v2"
	"github.com/telnyx/telnyx-go/v2/messaging/message"
)

// Config holds application configuration.
type Config struct {
	TelnyxAPIKey   string
	TelnyxPhoneNum string
	Port           string
	OTPExpiry      time.Duration
	OTPLength      int
	MaxAttempts    int
	AttemptLockout time.Duration
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() *Config {
	_ = godotenv.Load()

	otpExpiry := 5 * time.Minute
	if exp := os.Getenv("OTP_EXPIRY_MINUTES"); exp != "" {
		if mins, err := strconv.Atoi(exp); err == nil {
			otpExpiry = time.Duration(mins) * time.Minute
		}
	}

	return &Config{
		TelnyxAPIKey:   os.Getenv("TELNYX_API_KEY"),
		TelnyxPhoneNum: os.Getenv("TELNYX_PHONE_NUMBER"),
		Port:           getEnvOrDefault("PORT", "8080"),
		OTPExpiry:      otpExpiry,
		OTPLength:      6,
		MaxAttempts:    3,
		AttemptLockout: 15 * time.Minute,
	}
}

func getEnvOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

// OTPRecord stores OTP state for a user.
type OTPRecord struct {
	Code        string
	ExpiresAt   time.Time
	Attempts    int
	LockedUntil time.Time
	Verified    bool
	CreatedAt   time.Time
}

// OTPStore manages OTP records in memory.
type OTPStore struct {
	mu      sync.RWMutex
	records map[string]*OTPRecord
}

// NewOTPStore creates a new OTP store.
func NewOTPStore() *OTPStore {
	return &OTPStore{
		records: make(map[string]*OTPRecord),
	}
}

// GenerateOTP creates a random 6-digit code.
func GenerateOTP(length int) (string, error) {
	const digits = "0123456789"
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = digits[int(b[i])%len(digits)]
	}
	return string(b), nil
}

// Store saves an OTP record for a phone number.
func (s *OTPStore) Store(phoneNumber, code string, expiry time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.records[phoneNumber] = &OTPRecord{
		Code:      code,
		ExpiresAt: time.Now().Add(expiry),
		Attempts:  0,
		CreatedAt: time.Now(),
	}
}

// Verify checks if the provided code matches and hasn't expired.
func (s *OTPStore) Verify(phoneNumber, code string, cfg *Config) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	record, exists := s.records[phoneNumber]
	if !exists {
		return false, fmt.Errorf("no OTP found for this number")
	}

	if time.Now().Before(record.LockedUntil) {
		return false, fmt.Errorf("too many attempts; account locked until %v", record.LockedUntil)
	}

	if time.Now().After(record.ExpiresAt) {
		return false, fmt.Errorf("OTP has expired")
	}

	record.Attempts++

	if record.Attempts > cfg.MaxAttempts {
		record.LockedUntil = time.Now().Add(cfg.AttemptLockout)
		return false, fmt.Errorf("too many failed attempts; account locked")
	}

	if record.Code != code {
		return false, fmt.Errorf("invalid OTP code")
	}

	record.Verified = true
	delete(s.records, phoneNumber)

	return true, nil
}

// SendOTPSMS sends an OTP code via SMS using Telnyx.
func SendOTPSMS(client *telnyx.APIClient, toNumber, otpCode, fromNumber string) (string, error) {
	if toNumber[0] != '+' {
		return "", fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	messageText := fmt.Sprintf("Your verification code is: %s. Do not share this code.", otpCode)

	createMessageRequest := message.CreateMessageRequest{
		From: fromNumber,
		To:   toNumber,
		Text: messageText,
	}

	response, err := client.CreateMessage(createMessageRequest)
	if err != nil {
		return "", fmt.Errorf("failed to send SMS: %w", err)
	}

	if response.Data == nil || response.Data.ID == "" {
		return "", fmt.Errorf("no message ID in response")
	}

	return response.Data.ID, nil
}

// RequestOTPRequest represents the request body for OTP generation.
type RequestOTPRequest struct {
	PhoneNumber string `json:"phone_number" binding:"required"`
}

// RequestOTPResponse represents the response after OTP is sent.
type RequestOTPResponse struct {
	MessageID string `json:"message_id"`
	Status    string `json:"status"`
	ExpiresIn int    `json:"expires_in_seconds"`
}

// VerifyOTPRequest represents the request body for OTP verification.
type VerifyOTPRequest struct {
	PhoneNumber string `json:"phone_number" binding:"required"`
	Code        string `json:"code" binding:"required"`
}

// VerifyOTPResponse represents the response after OTP verification.
type VerifyOTPResponse struct {
	Verified bool   `json:"verified"`
	Message  string `json:"message"`
}

// RequestOTPHandler generates and sends an OTP via SMS.
func RequestOTPHandler(client *telnyx.APIClient, store *OTPStore, cfg *Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req RequestOTPRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required field: phone_number"})
			return
		}

		otpCode, err := GenerateOTP(cfg.OTPLength)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate OTP"})
			return
		}

		messageID, err := SendOTPSMS(client, req.PhoneNumber, otpCode, cfg.TelnyxPhoneNum)
		if err != nil {
			if authErr, ok := err.(*telnyx.AuthenticationError); ok {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
				return
			}
			if rateLimitErr, ok := err.(*telnyx.RateLimitError); ok {
				c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
				return
			}
			if apiErr, ok := err.(*telnyx.APIStatusError); ok {
				c.JSON(apiErr.Status, gin.H{"error": apiErr.Error()})
				return
			}
			if connErr, ok := err.(*telnyx.APIConnectionError); ok {
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error: " + connErr.Error()})
				return
			}

			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		store.Store(req.PhoneNumber, otpCode, cfg.OTPExpiry)

		c.JSON(http.StatusOK, RequestOTPResponse{
			MessageID: messageID,
			Status:    "sent",
			ExpiresIn: int(cfg.OTPExpiry.Seconds()),
		})
	}
}

// VerifyOTPHandler verifies the OTP code provided by the user.
func VerifyOTPHandler(store *OTPStore, cfg *Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req VerifyOTPRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields: phone_number, code"})
			return
		}

		verified, err := store.Verify(req.PhoneNumber, req.Code, cfg)
		if err != nil {
			c.JSON(http.StatusUnauthorized, VerifyOTPResponse{
				Verified: false,
				Message:  err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, VerifyOTPResponse{
			Verified: verified,
			Message:  "OTP verified successfully",
		})
	}
}

// HealthCheckHandler returns the health status of the service.
func HealthCheckHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy"})
	}
}

func main() {
	cfg := LoadConfig()

	if cfg.TelnyxAPIKey == "" {
		log.Fatal("TELNYX_API_KEY environment variable not set")
	}
	if cfg.TelnyxPhoneNum == "" {
		log.Fatal("TELNYX_PHONE_NUMBER environment variable not set")
	}

	client := telnyx.NewClient(telnyx.WithAPIKey(cfg.TelnyxAPIKey))
	otpStore := NewOTPStore()

	router := gin.Default()

	router.GET("/health", HealthCheckHandler())
	router.POST("/otp/request", RequestOTPHandler(client, otpStore, cfg))
	router.POST("/otp/verify", VerifyOTPHandler(otpStore, cfg))

	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("Starting OTP 2FA server on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
