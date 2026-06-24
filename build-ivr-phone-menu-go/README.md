# Ivr Menu with Go and Gin

## What Does This Example Do?

Build a production-ready Interactive Voice Response (IVR) system using Go, Gin, and the Telnyx Voice API. This tutorial demonstrates how to handle inbound calls, collect DTMF input, play voice prompts, and route calls based on user selections. You'll implement a complete call control flow with webhook handling, state management, and proper error handling for production resilience.

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
- A Telnyx phone number enabled for inbound calls.
- A Call Control Application configured in the Telnyx Portal with a webhook URL pointing to your server.
- ngrok or similar tool to expose your local server to the internet for webhook testing.
- Basic familiarity with Go, Gin, and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-ivr-phone-menu-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-ivr-phone-menu-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `handlers.go` to implement webhook handlers and call control logic:

```go
package main

import (
	"fmt"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/telnyx/telnyx-go"
	"github.com/telnyx/telnyx-go/v2"
)

// In-memory store for active call states (use Redis in production)
var (
	callStates = make(map[string]*CallState)
	mu         sync.RWMutex
)

// HandleCallInitiated processes incoming calls
func HandleCallInitiated(c *gin.Context, client *telnyx.Client) {
	var event WebhookEvent
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	callControlID := event.Data.CallControlID
	from := event.Data.From
	to := event.Data.To

	// Store call state
	mu.Lock()
	callStates[callControlID] = &CallState{
		CallControlID: callControlID,
		From:          from,
		To:            to,
		MenuLevel:     0,
	}
	mu.Unlock()

	// Answer the call
	_, err := client.Calls.Actions.Answer(callControlID, nil)
	if err != nil {
		handleAPIError(c, err)
		return
	}

	// Play welcome message and present main menu
	playMainMenu(c, client, callControlID)
}

// HandleDTMFReceived processes DTMF input from the caller
func HandleDTMFReceived(c *gin.Context, client *telnyx.Client) {
	var event WebhookEvent
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	callControlID := event.Data.CallControlID
	digit := event.Data.DTMFDigits

	mu.RLock()
	state, exists := callStates[callControlID]
	mu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Call state not found"})
		return
	}

	// Route based on menu level and digit selection
	switch state.MenuLevel {
	case 0: // Main menu
		handleMainMenuSelection(c, client, callControlID, digit, state)
	case 1: // Sales submenu
		handleSalesSubmenu(c, client, callControlID, digit, state)
	case 2: // Support submenu
		handleSupportSubmenu(c, client, callControlID, digit, state)
	default:
		c.JSON(http.StatusOK, gin.H{"status": "unknown_menu_level"})
	}
}

// HandleCallHangup cleans up call state when call ends
func HandleCallHangup(c *gin.Context) {
	var event WebhookEvent
	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid webhook payload"})
		return
	}

	callControlID := event.Data.CallControlID

	// Remove call state from memory
	mu.Lock()
	delete(callStates, callControlID)
	mu.Unlock()

	c.JSON(http.StatusOK, gin.H{"status": "call_ended"})
}

// playMainMenu plays the main menu prompt and waits for DTMF input
func playMainMenu(c *gin.Context, client *telnyx.Client, callControlID string) {
	prompt := "Welcome to our IVR system. Press 1 for Sales, 2 for Support, or 3 to repeat this menu."

	_, err := client.Calls.Actions.Speak(callControlID, &telnyx.CallSpeakRequest{
		Payload: prompt,
		Voice:   "female",
		Language: "en-US",
	})
	if err != nil {
		handleAPIError(c, err)
		return
	}

	// Start gathering DTMF input
	_, err = client.Calls.Actions.GatherDTMF(callControlID, &telnyx.CallGatherDTMFRequest{
		MaxDigits:      1,
		TimeoutMillis:  5000,
		TerminatingDigit: "#",
	})
	if err != nil {
		handleAPIError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "menu_presented"})
}

// handleMainMenuSelection routes based on main menu digit
func handleMainMenuSelection(c *gin.Context, client *telnyx.Client, callControlID, digit string, state *CallState) {
	switch digit {
	case "1":
		// Route to Sales
		mu.Lock()
		state.MenuLevel = 1
		state.Selection = "sales"
		mu.Unlock()

		prompt := "You selected Sales. Press 1 for New Customers, 2 for Existing Customers, or 0 to return to main menu."
		speakAndGather(c, client, callControlID, prompt)

	case "2":
		// Route to Support
		mu.Lock()
		state.MenuLevel = 2
		state.Selection = "support"
		mu.Unlock()

		prompt := "You selected Support. Press 1 for Technical Support, 2 for Billing, or 0 to return to main menu."
		speakAndGather(c, client, callControlID, prompt)

	case "3":
		// Repeat main menu
		playMainMenu(c, client, callControlID)

	default:
		prompt := "Invalid selection. Please try again."
		speakAndGather(c, client, callControlID, prompt)
	}
}

// handleSalesSubmenu processes Sales menu selections
func handleSalesSubmenu(c *gin.Context, client *telnyx.Client, callControlID, digit string, state *CallState) {
	switch digit {
	case "1":
		// New Customers — transfer to sales agent
		transferCall(c, client, callControlID, "+15551234567", "New Customer Inquiry")

	case "2":
		// Existing Customers — transfer to account manager
		transferCall(c, client, callControlID, "+15559876543", "Existing Customer Support")

	case "0":
		// Return to main menu
		mu.Lock()
		state.MenuLevel = 0
		mu.Unlock()
		playMainMenu(c, client, callControlID)

	default:
		prompt := "Invalid selection. Press 1 for New Customers, 2 for Existing Customers, or 0 to return."
		speakAndGather(c, client, callControlID, prompt)
	}
}

// handleSupportSubmenu processes Support menu selections
func handleSupportSubmenu(c *gin.Context, client *telnyx.Client, callControlID, digit string, state *CallState) {
	switch digit {
	case "1":
		// Technical Support
		transferCall(c, client, callControlID, "+15551111111", "Technical Support Request")

	case "2":
		// Billing
		transferCall(c, client, callControlID, "+15552222222", "Billing Inquiry")

	case "0":
		// Return to main menu
		mu.Lock()
		state.MenuLevel = 0
		mu.Unlock()
		playMainMenu(c, client, callControlID)

	default:
		prompt := "Invalid selection. Press 1 for Technical Support, 2 for Billing, or 0 to return."
		speakAndGather(c, client, callControlID, prompt)
	}
}

// speakAndGather plays a prompt and waits for DTMF input
func speakAndGather(c *gin.Context, client *telnyx.Client, callControlID, prompt string) {
	_, err := client.Calls.Actions.Speak(callControlID, &telnyx.CallSpeakRequest{
		Payload:  prompt,
		Voice:    "female",
		Language: "en-US",
	})
	if err != nil {
		handleAPIError(c, err)
		return
	}

	_, err = client.Calls.Actions.GatherDTMF(callControlID, &telnyx.CallGatherDTMFRequest{
		MaxDigits:        1,
		TimeoutMillis:    5000,
		TerminatingDigit: "#",
	})
	if err != nil {
		handleAPIError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "gathering_input"})
}

// transferCall transfers the call to a destination number
func transferCall(c *gin.Context, client *telnyx.Client, callControlID, destination, reason string) {
	_, err := client.Calls.Actions.Transfer(callControlID, &telnyx.CallTransferRequest{
		To: destination,
	})
	if err != nil {
		handleAPIError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":      "call_transferred",
		"destination": destination,
		"reason":      reason,
	})
}

// handleAPIError maps Telnyx SDK errors to HTTP status codes
func handleAPIError(c *gin.Context, err error) {
	switch e := err.(type) {
	case *telnyx.AuthenticationError:
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
	case *telnyx.RateLimitError:
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
	case *telnyx.APIStatusError:
		c.JSON(e.StatusCode, gin.H{"error": e.Error()})
	case *telnyx.APIConnectionError:
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Network error connecting to Telnyx"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
	}
}
```

## Complete Code

See [`main.go`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-go/main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The webhook handler returns `{"error": "Invalid API key"}` when attempting to answer or control a call. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the server after updating the key. |
| Webhook Not Received | The IVR server is running but webhook endpoints are not being called when calls arrive. | Confirm your Call Control Application in the Telnyx Portal is configured with the correct webhook URLs (e.g., `https://your-ngrok-url.ngrok.io/webhooks/call-initiated`). Verify ngrok is running and the tunnel is active. Check that your firewall allows inbound HTTPS traffic on port 8080. |
| DTMF Input Not Recognized | Callers press digits but the IVR does not respond to their selections. | Ensure the `GatherDTMF` call is made after the `Speak` action completes. Verify the `MaxDigits` and `TimeoutMillis` parameters are appropriate for your use case. Check that the caller's phone supports DTMF transmission (some VoIP providers may disable it). |
| Call Transfer Fails | The transfer action returns an error or the call is not transferred to the destination. | Verify the destination phone numbers in `handleSalesSubmenu` and `handleSupportSubmenu` are valid and in E.164 format (e.g., `+15551234567`). Ensure your Telnyx account has outbound calling permissions. Check that the destination numbers are reachable and not blocked. |
| In-Memory State Lost | Call state is lost when the server restarts or multiple instances are running. | For production, replace the in-memory `callStates` map with a persistent data store like Redis. Use a distributed cache with TTL to automatically clean up stale call states. Implement proper session management across multiple server instances. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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

- [Handle
