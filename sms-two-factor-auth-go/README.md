# OTP 2FA with Go and Gin

## What Does This Example Do?

Build a production-ready two-factor authentication (2FA) system using Go, Gin, and the Telnyx SMS API. This tutorial demonstrates OTP generation, secure storage with expiration, SMS delivery via Telnyx, and verification workflows. You'll learn proper error handling for telecom APIs, rate limiting to prevent brute-force attacks, and idiomatic Go patterns for web services.

## Who Is This For?

- **Go developers** building sms features with Gin.
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
- A Telnyx phone number enabled for outbound SMS.
- Basic familiarity with Go and REST APIs.
- `go get` (Go package manager).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `otp.go` to handle OTP generation, storage, and verification:

```go
package main

import (
	"crypto/rand"
	"fmt"
	"sync"
	"time"
)

// OTPRecord stores OTP state for a user.
type OTPRecord struct {
	Code           string
	ExpiresAt      time.Time
	Attempts       int
	LockedUntil    time.Time
	Verified       bool
	CreatedAt      time.Time
}

// OTPStore manages OTP records in memory (use Redis/database in production).
type OTPStore struct {
	mu      sync.RWMutex
	records map[string]*OTPRecord
}

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

	// Check if account is locked due to too many attempts.
	if time.Now().Before(record.LockedUntil) {
		return false, fmt.Errorf("too many attempts; account locked until %v", record.LockedUntil)
	}

	// Check if OTP has expired.
	if time.Now().After(record.ExpiresAt) {
		return false, fmt.Errorf("OTP has expired")
	}

	// Increment attempt counter.
	record.Attempts++

	// Lock account after max attempts.
	if record.Attempts > cfg.MaxAttempts {
		record.LockedUntil = time.Now().Add(cfg.AttemptLockout)
		return false, fmt.Errorf("too many failed attempts; account locked")
	}

	// Verify code.
	if record.Code != code {
		return false, fmt.Errorf("invalid OTP code")
	}

	// Mark as verified and clean up.
	record.Verified = true
	delete(s.records, phoneNumber)

	return true, nil
}

// Get retrieves an OTP record (for testing/debugging only).
func (s *OTPStore) Get(phoneNumber string) *OTPRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.records[phoneNumber]
}
```

Create `sms.go` to handle SMS delivery via Telnyx:

```go
package main

import (
	"fmt"

	"github.com/telnyx/telnyx-go/v2"
	"github.com/telnyx/telnyx-go/v2/messaging"
	"github.com/telnyx/telnyx-go/v2/messaging/message"
)

// SendOTPSMS sends an OTP code via SMS using Telnyx.
func SendOTPSMS(client *telnyx.APIClient, toNumber, otpCode, fromNumber string) (string, error) {
	// Validate E.164 format.
	if toNumber[0] != '+' {
		return "", fmt.Errorf("phone number must be in E.164 format (e.g., +15551234567)")
	}

	messageText := fmt.Sprintf("Your verification code is: %s. Do not share this code.", otpCode)

	// Create message request.
	createMessageRequest := message.CreateMessageRequest{
		From: fromNumber,
		To:   toNumber,
		Text: messageText,
	}

	// Send message via Telnyx API.
	response, err := client.CreateMessage(createMessageRequest)
	if err != nil {
		return "", fmt.Errorf("failed to send SMS: %w", err)
	}

	// Extract message ID from response.
	if response.Data == nil || response.Data.ID == "" {
		return "", fmt.Errorf("no message ID in response")
	}

	return response.Data.ID, nil
}
```

Create `handlers.go` to define HTTP endpoints:

```go
package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/telnyx/telnyx-go/v2"
)

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

		// Generate OTP code.
		otpCode, err := GenerateOTP(cfg.OTPLength)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate OTP"})
			return
		}

		// Send OTP via SMS.
		messageID, err := SendOTPSMS(client, req.PhoneNumber, otpCode, cfg.TelnyxPhoneNum)
		if err != nil {
			// Handle Telnyx-specific errors.
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

			// Generic error.
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Store OTP for later verification.
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

		// Verify OTP.
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
```

Create `main.go` to initialize the Gin server and routes:

```go
package main

import (
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/telnyx/telnyx-go/v2"
)

func main() {
	// Load configuration from environment.
	cfg := LoadConfig()

	// Validate required configuration.
	if cfg.TelnyxAPIKey == "" {
		log.Fatal("TELNYX_API_KEY environment variable not set")
	}
	if cfg.TelnyxPhoneNum == "" {
		log.Fatal("TELNYX_PHONE_NUMBER environment variable not set")
	}

	// Initialize Telnyx client.
	client := telnyx.NewClient(telnyx.WithAPIKey(cfg.TelnyxAPIKey))

	// Initialize OTP store.
	otpStore := NewOTPStore()

	// Create Gin router.
	router := gin.Default()

	// Define routes.
	router.GET("/health", HealthCheckHandler())
	router.POST("/otp/request", RequestOTPHandler(client, otpStore, cfg))
	router.POST("/otp/verify", VerifyOTPHandler(otpStore, cfg))

	// Start server.
	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("Starting OTP 2FA server on %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-two-factor-auth-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Go server. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| OTP Expired Before Verification | The verification endpoint returns `{"verified": false, "message": "OTP has expired"}` even though the code was just sent. | Check that your system clock is synchronized. The default OTP expiry is 5 minutes; you can adjust this by setting the `OTP_EXPIRY_MINUTES` environment variable. Ensure the client is submitting the code within the expiry window. |
| Too Many Failed Attempts | After 3 incorrect OTP attempts, the endpoint returns `{"verified": false, "message": "too many failed attempts; account locked"}`. | The account is locked for 15 minutes by default to prevent brute-force attacks. Wait 15 minutes or adjust the `AttemptLockout` duration in the `Config` struct. Request a new OTP after the lockout period expires. |
| Environment Variable Not Set | The application exits with `TELNYX_API_KEY environment variable not set` on startup. | Confirm your `.env` file exists in the same directory as the Go binary and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `godotenv.Load()` call must execute before `os.Getenv()` is called. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Go version do I need?**

Go 1.22 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Send a Single SMS with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/send-single-sms).
- [Receive SMS Webhooks with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/receive-sms-webhook).
- [Send Bulk SMS Messages with Go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/go/send-bulk-sms).
