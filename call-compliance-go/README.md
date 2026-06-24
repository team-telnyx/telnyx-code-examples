# Call Compliance with Go and Gin

## What Does This Example Do?

Build a production-ready Go application with Gin that implements call compliance tracking and recording management using the Telnyx Voice API. This tutorial demonstrates how to initiate calls, handle webhook events, manage call recordings, and maintain compliance logs—essential for regulated industries like healthcare, finance, and customer service. You'll learn the command-event model of Telnyx Call Control, proper webhook validation, and secure credential management.

## Who Is This For?

- **Go developers** building voice features with Gin.
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
- A Telnyx phone number enabled for outbound calls.
- A Call Control Application configured in the Telnyx Portal with a connection ID.
- A publicly accessible webhook URL (use ngrok for local development).
- Basic familiarity with Go, Gin, and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-compliance-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a `models.go` file to define data structures for call compliance tracking:

```go
package main

import (
	"time"
)

// CallRecord represents a compliance-tracked call
type CallRecord struct {
	CallControlID string    `json:"call_control_id"`
	FromNumber    string    `json:"from_number"`
	ToNumber      string    `json:"to_number"`
	Status        string    `json:"status"`
	StartTime     time.Time `json:"start_time"`
	EndTime       *time.Time `json:"end_time,omitempty"`
	Duration      int       `json:"duration_seconds,omitempty"`
	RecordingID   string    `json:"recording_id,omitempty"`
	IsRecorded    bool      `json:"is_recorded"`
	ComplianceLog string    `json:"compliance_log"`
}

// WebhookPayload represents incoming Telnyx webhook events
type WebhookPayload struct {
	Data struct {
		EventType     string `json:"event_type"`
		CallControlID string `json:"call_control_id"`
		From          string `json:"from"`
		To            string `json:"to"`
		State         string `json:"state"`
		RecordingID   string `json:"recording_id,omitempty"`
	} `json:"data"`
}

// In-memory store for call records (use a database in production)
var callRecords = make(map[string]*CallRecord)
```

Create a `handlers.go` file with HTTP handlers for initiating calls and managing webhooks:

```go
package main

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/team-telnyx/telnyx-go/v4"
)

// InitiateCallRequest represents the request body for initiating a call
type InitiateCallRequest struct {
	ToNumber string `json:"to_number" binding:"required"`
}

// InitiateCall handles outbound call initiation with compliance tracking
func InitiateCall(c *gin.Context) {
	var req InitiateCallRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required field: to_number"})
		return
	}

	// Validate E.164 format
	if len(req.ToNumber) < 10 || req.ToNumber[0] != '+' {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Phone number must be in E.164 format (e.g., +15551234567)"})
		return
	}

	// Initiate call via Telnyx API
	response, err := client.Calls.Dial(
		&telnyx.CallDialParams{
			From:         telnyx.String(config.PhoneNumber),
			To:           telnyx.String(req.ToNumber),
			ConnectionID: telnyx.String(config.ConnectionID),
		},
	)

	if err != nil {
		handleAPIError(c, err)
		return
	}

	// Extract call control ID from response
	callControlID := response.Data.CallControlID

	// Create compliance record
	record := &CallRecord{
		CallControlID: callControlID,
		FromNumber:    config.PhoneNumber,
		ToNumber:      req.ToNumber,
		Status:        "initiated",
		StartTime:     time.Now(),
		IsRecorded:    false,
		ComplianceLog: fmt.Sprintf("[%s] Call initiated from %s to %s", time.Now().Format(time.RFC3339), config.PhoneNumber, req.ToNumber),
	}

	callRecords[callControlID] = record

	c.JSON(http.StatusOK, gin.H{
		"call_control_id": callControlID,
		"from_number":     config.PhoneNumber,
		"to_number":       req.ToNumber,
		"status":          "initiated",
	})
}

// HandleWebhook processes incoming Telnyx call events
func HandleWebhook(c *gin.Context) {
	var payload WebhookPayload

	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	callControlID := payload.Data.CallControlID
	eventType := payload.Data.EventType

	// Retrieve or create call record
	record, exists := callRecords[callControlID]
	if !exists {
		record = &CallRecord{
			CallControlID: callControlID,
			FromNumber:    payload.Data.From,
			ToNumber:      payload.Data.To,
			Status:        "unknown",
			StartTime:     time.Now(),
			IsRecorded:    false,
			ComplianceLog: "",
		}
		callRecords[callControlID] = record
	}

	// Update record based on event type
	switch eventType {
	case "call.answered":
		record.Status = "answered"
		record.ComplianceLog += fmt.Sprintf("\n[%s] Call answered", time.Now().Format(time.RFC3339))

		// Automatically start recording for compliance
		_, err := client.Calls.Actions.StartRecording(
			callControlID,
			&telnyx.CallStartRecordingParams{
				Format: telnyx.String("wav"),
			},
		)
		if err != nil {
			record.ComplianceLog += fmt.Sprintf("\n[%s] Recording start failed: %v", time.Now().Format(time.RFC3339), err)
		} else {
			record.IsRecorded = true
			record.ComplianceLog += fmt.Sprintf("\n[%s] Recording started", time.Now().Format(time.RFC3339))
		}

	case "call.hangup":
		record.Status = "completed"
		now := time.Now()
		record.EndTime = &now
		record.Duration = int(now.Sub(record.StartTime).Seconds())
		record.ComplianceLog += fmt.Sprintf("\n[%s] Call ended (duration: %d seconds)", now.Format(time.RFC3339), record.Duration)

		// Stop recording if active
		if record.IsRecorded {
			_, err := client.Calls.Actions.StopRecording(callControlID, &telnyx.CallStopRecordingParams{})
			if err != nil {
				record.ComplianceLog += fmt.Sprintf("\n[%s] Recording stop failed: %v", time.Now().Format(time.RFC3339), err)
			} else {
				record.ComplianceLog += fmt.Sprintf("\n[%s] Recording stopped", time.Now().Format(time.RFC3339))
			}
		}

	case "call.recording.saved":
		record.RecordingID = payload.Data.RecordingID
		record.ComplianceLog += fmt.Sprintf("\n[%s] Recording saved with ID: %s", time.Now().Format(time.RFC3339), payload.Data.RecordingID)

	default:
		record.ComplianceLog += fmt.Sprintf("\n[%s] Event received: %s", time.Now().Format(time.RFC3339), eventType)
	}

	c.JSON(http.StatusOK, gin.H{"status": "received"})
}

// GetCallStatus retrieves the compliance record for a call
func GetCallStatus(c *gin.Context) {
	callControlID := c.Param("call_control_id")

	record, exists := callRecords[callControlID]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Call record not found"})
		return
	}

	c.JSON(http.StatusOK, record)
}

// ListCallRecords returns all compliance records
func ListCallRecords(c *gin.Context) {
	records := make([]map[string]interface{}, 0)

	for _, record := range callRecords {
		records = append(records, map[string]interface{}{
			"call_control_id": record.CallControlID,
			"from_number":     record.FromNumber,
			"to_number":       record.ToNumber,
			"status":          record.Status,
			"start_time":      record.StartTime,
			"end_time":        record.EndTime,
			"duration":        record.Duration,
			"is_recorded":     record.IsRecorded,
			"recording_id":    record.RecordingID,
		})
	}

	c.JSON(http.StatusOK, gin.H{"records": records})
}

// handleAPIError maps Telnyx SDK errors to HTTP status codes
func handleAPIError(c *gin.Context, err error) {
	switch err.(type) {
	case *telnyx.AuthenticationError:
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
	case *telnyx.RateLimitError:
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded. Please slow down."})
	case *telnyx.APIConnectionError:
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
	case *telnyx.APIStatusError:
		statusErr := err.(*telnyx.APIStatusError)
		c.JSON(statusErr.StatusCode, gin.H{"error": statusErr.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
	}
}
```

Create a `main.go` file to set up the Gin router and start the server:

```go
package main

import (
	"github.com/gin-gonic/gin"
)

func main() {
	// Create Gin router
	router := gin.Default()

	// Define routes
	router.POST("/calls/initiate", InitiateCall)
	router.POST("/webhooks/call", HandleWebhook)
	router.GET("/calls/:call_control_id", GetCallStatus)
	router.GET("/calls", ListCallRecords)

	// Start server
	router.Run(":" + config.Port)
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-compliance-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Go server. |
| Connection ID Not Found | Calls fail with an error about invalid connection ID. | Confirm your `TELNYX_CONNECTION_ID` is set correctly in the `.env` file and matches a Call Control Application configured in the Telnyx Portal. The connection ID links your phone number to the Call Control application and must be created before initiating calls. |
| Webhook Events Not Received | The `/webhooks/call` endpoint is not receiving events from Telnyx. | Ensure your webhook URL is publicly accessible and configured in the Telnyx Portal under your Call Control Application settings. Use ngrok (`ngrok http 8080`) to expose your local server during development. Verify the webhook URL in the Portal matches your actual endpoint (e.g., `https://your-domain.com/webhooks/call`). |
| Recording Not Starting | Calls complete but `is_recorded` remains false. | Verify your Call Control Application has recording permissions enabled in the Telnyx Portal. Check the compliance log for specific error messages. Some connection types may require explicit recording configuration. |
| Phone Number Format Error | Requests fail with "Phone number must be in E.164 format". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test requests to use properly formatted numbers. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Go version do I need?**

Go 1.22 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Voice API Overview](https://developers.telnyx.com/docs/voice)
- [Voice API Commands](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources)
- [AI Assistant Start](https://developers.telnyx.com/docs/voice/programmable-voice/ai-assistant-start)
- [Call Control API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx Voice API](https://telnyx.com/products/voice-api)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [Handle Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/inbound-call-webhook).
- [Record and Manage Call Recordings](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/call-recording).
- [Transfer Calls Between Agents](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/go/call-transfer).
