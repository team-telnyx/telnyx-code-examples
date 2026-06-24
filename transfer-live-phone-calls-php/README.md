# Call Transfer with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that handles inbound calls and transfers them to another number using the Telnyx Voice API. This tutorial demonstrates the Call Control command-event model, webhook handling for call lifecycle events, and secure credential management via environment variables. You'll learn how to answer incoming calls, initiate transfers, and manage call state across webhook events.

## Who Is This For?

- **PHP developers** building voice features with Laravel.
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

- PHP 8.1 or higher.
- Laravel 10 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for inbound calls.
- A Call Control Application configured in the Telnyx Portal with a webhook URL pointing to your application.
- Composer (PHP package manager).
- A publicly accessible URL for webhook callbacks (use ngrok for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/transfer-live-phone-calls-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/transfer-live-phone-calls-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a controller to handle call webhooks and transfer logic:

```bash
php artisan make:controller CallTransferController
```

Edit `app/Http/Controllers/CallTransferController.php`:

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Telnyx\Client;
use Telnyx\Exception\ApiErrorException;

class CallTransferController extends Controller
{
    private Client $client;

    public function __construct()
    {
        // Initialize Telnyx client with API key from environment
        $this->client = new Client(apiKey: env('TELNYX_API_KEY'));
    }

    /**
     * Handle incoming call webhook events.
     * Telnyx sends call.initiated, call.answered, call.hangup, etc. to this endpoint.
     */
    public function handleWebhook(Request $request): JsonResponse
    {
        $payload = $request->all();
        $eventType = $payload['data']['event_type'] ?? null;
        $callControlId = $payload['data']['call_control_id'] ?? null;

        // Log the event for debugging
        \Log::info('Call webhook received', [
            'event_type' => $eventType,
            'call_control_id' => $callControlId,
        ]);

        // Route to appropriate handler based on event type
        match ($eventType) {
            'call.initiated' => $this->handleCallInitiated($payload),
            'call.answered' => $this->handleCallAnswered($payload),
            'call.hangup' => $this->handleCallHangup($payload),
            default => null,
        };

        // Always return 200 OK to acknowledge receipt
        return response()->json(['status' => 'ok'], 200);
    }

    /**
     * Handle call.initiated event — answer the incoming call.
     */
    private function handleCallInitiated(array $payload): void
    {
        $callControlId = $payload['data']['call_control_id'];

        try {
            // Answer the incoming call
            $this->client->calls->actions->answer($callControlId);

            \Log::info('Call answered', ['call_control_id' => $callControlId]);
        } catch (ApiErrorException $e) {
            \Log::error('Failed to answer call', [
                'call_control_id' => $callControlId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Handle call.answered event — initiate transfer to destination number.
     */
    private function handleCallAnswered(array $payload): void
    {
        $callControlId = $payload['data']['call_control_id'];
        $transferNumber = env('TELNYX_TRANSFER_NUMBER');

        try {
            // Transfer the call to the configured destination number
            $this->client->calls->actions->transfer(
                $callControlId,
                to: $transferNumber
            );

            \Log::info('Call transferred', [
                'call_control_id' => $callControlId,
                'transfer_to' => $transferNumber,
            ]);
        } catch (ApiErrorException $e) {
            \Log::error('Failed to transfer call', [
                'call_control_id' => $callControlId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Handle call.hangup event — clean up resources.
     */
    private function handleCallHangup(array $payload): void
    {
        $callControlId = $payload['data']['call_control_id'];
        $hangupReason = $payload['data']['hangup_reason'] ?? 'unknown';

        \Log::info('Call ended', [
            'call_control_id' => $callControlId,
            'reason' => $hangupReason,
        ]);
    }

    /**
     * Endpoint to initiate an outbound call (for testing).
     * POST /api/calls/initiate with JSON body: {"to": "+15559876543"}
     */
    public function initiateCall(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'to' => 'required|string|regex:/^\+\d{10,15}$/',
        ]);

        $toNumber = $validated['to'];
        $fromNumber = env('TELNYX_PHONE_NUMBER');
        $connectionId = env('TELNYX_CONNECTION_ID');

        try {
            // Initiate outbound call
            $response = $this->client->calls->dial(
                from_: $fromNumber,
                to: $toNumber,
                connection_id: $connectionId
            );

            // Extract call_control_id from response — this is returned by the API
            $callControlId = $response->data->call_control_id;

            return response()->json([
                'call_control_id' => $callControlId,
                'from' => $fromNumber,
                'to' => $toNumber,
                'status' => 'initiated',
            ], 201);

        } catch (ApiErrorException $e) {
            \Log::error('Failed to initiate call', [
                'to' => $toNumber,
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'error' => $e->getMessage(),
            ], $e->getHttpStatus() ?? 500);
        }
    }
}
```

Register the webhook route in `routes/api.php`:

```php
<?php

use App\Http\Controllers\CallTransferController;
use Illuminate\Support\Facades\Route;

Route::post('/webhooks/call', [CallTransferController::class, 'handleWebhook']);
Route::post('/calls/initiate', [CallTransferController::class, 'initiateCall']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The API returns `{"error": "Unauthorized"}` or webhook handling fails silently. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Laravel server after updating the `.env` file. Use `php artisan config:cache` to refresh cached configuration if needed. |
| Webhook Not Received | Inbound calls do not trigger the webhook endpoint; logs show no incoming events. | Confirm your ngrok URL is correctly configured in the Telnyx Call Control Application webhook settings. The URL must be `https://your-ngrok-url/api/webhooks/call` (HTTPS, not HTTP). Verify your firewall and router allow inbound HTTPS traffic. Test the webhook manually using curl: `curl -X POST https://your-ngrok-url/api/webhooks/call -H "Content-Type: application/json" -d '{"data":{"event_type":"call.initiated","call_control_id":"test"}}'`. |
| Transfer Fails Silently | The call is answered but transfer does not occur; logs show no transfer error. | Ensure `TELNYX_TRANSFER_NUMBER` is set in `.env` and is a valid E.164 phone number (e.g., `+15559876543`). Verify the destination number is reachable and not blocked. Check that the call is in the `answered` state before attempting transfer — the `call.answered` event must fire first. Review logs for any `ApiErrorException` messages that indicate the actual failure reason. |
| Invalid Phone Number Format | The `/api/calls/initiate` endpoint returns a 422 validation error. | Ensure the phone number in your request uses E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl command to use a properly formatted number. |
| Call Control ID Not Found | Transfer or hangup actions fail with "call_control_id not found" error. | The `call_control_id` is a runtime value returned by the API after a call is initiated or received. Do not confuse it with `TELNYX_CONNECTION_ID` (your static Call Control Application ID). Ensure you are extracting `call_control_id` from the webhook payload correctly: `$payload['data']['call_control_id']`. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What PHP version do I need?**

PHP 8.1 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Voice API Overview](https://developers.telnyx.com/docs/voice)
- [Voice API Commands](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources)
- [AI Assistant Start](https://developers.telnyx.com/docs/voice/programmable-voice/ai-assistant-start)
- [Call Control API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Telnyx Voice API](https://telnyx.com/products/voice-api)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [Handle Inbound Calls with Webhooks](/tutorials/voice/php/inbound-call-webhook).
- [Record Calls with PHP and Laravel](/tutorials/voice/php/call-recording).
- [Build an IVR Menu with PHP and Laravel](/tutorials/voice/php/ivr-menu).
