# SIM Activation with Go and Gin

## What Does This Example Do?

Build a production-ready Gin endpoint that activates SIM cards using the Telnyx Go SDK. This tutorial demonstrates the new client-based initialization pattern, proper error handling for IoT APIs, and secure credential management via environment variables. You'll learn how to activate SIM cards, handle API responses, and implement comprehensive error handling for production resilience.

## Who Is This For?

- **Go developers** building iot features with Gin.
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
- At least one SIM card in your Telnyx account (in `ready` or `standby` status).
- The SIM card ID (available in the Telnyx Portal under IoT → SIM Cards).
- Go modules enabled in your project.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/activate-sim-card-go
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/activate-sim-card-go
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `main.go` and initialize the Telnyx client using the new pattern. Define a helper function to handle SIM activation with proper validation:

```go
package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/telnyx/telnyx-go/v2"
)

// Initialize client with the new SDK pattern
var client *telnyx.Client

func init() {
	// Load environment variables from .env file
	godotenv.Load()

	// Initialize Telnyx client with API key from environment
	apiKey := os.Getenv("TELNYX_API_KEY")
	if apiKey == "" {
		panic("TELNYX_API_KEY environment variable not set")
	}

	client = telnyx.NewClient(telnyx.WithAPIKey(apiKey))
}

// activateSIM activates a SIM card and returns JSON-serializable response data.
func activateSIM(simCardID string) (map[string]interface{}, error) {
	// Validate SIM card ID is not empty
	if simCardID == "" {
		return nil, fmt.Errorf("SIM card ID cannot be empty")
	}

	// Use client.SimCards.Activate() to activate the SIM
	response, err := client.SimCards.Activate(simCardID, nil)
	if err != nil {
		return nil, err
	}

	// Extract serializable data — SDK objects must be unpacked to plain maps
	result := map[string]interface{}{
		"id":                response.Data.ID,
		"iccid":             response.Data.ICCID,
		"status":            response.Data.Status,
		"sim_card_group_id": response.Data.SimCardGroupID,
	}

	return result, nil
}
```

## Complete Code

See [`main.go`](./main.go) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Go server. |
| SIM Card Not Found (404) | You receive a 404 error stating the SIM card ID does not exist. | Confirm the SIM card ID is correct by checking the [Telnyx Portal](https://portal.telnyx.com) under IoT → SIM Cards. Copy the full UUID exactly as shown. Verify the SIM card belongs to your account and is not in a deleted state. |
| SIM Card Already Active | The API returns an error indicating the SIM is already in `active` status. | SIM cards can only be activated once from `ready` or `standby` status. If the SIM is already `active`, you cannot activate it again. To test activation, use a SIM card in `ready` or `standby` status. Check the SIM status in the Telnyx Portal before attempting activation. |
| Environment Variable Not Set | The application panics with `TELNYX_API_KEY environment variable not set` on startup. | Confirm your `.env` file exists in the same directory as `main.go` and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `godotenv.Load()` call must execute before `os.Getenv()` is called—verify this import order in your code. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Go version do I need?**

Go 1.22 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [SIM Card API Reference](https://developers.telnyx.com/api-reference/sim-cards/get-all-sim-cards)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)

## Related Examples

- [Monitor SIM Data Usage](/tutorials/iot/go/data-usage-monitoring).
- [Configure Custom APN Settings](/tutorials/iot/go/apn-configuration).
- [Handle SIM Status Change Webhooks](/tutorials/iot/go/sim-status-webhook).
