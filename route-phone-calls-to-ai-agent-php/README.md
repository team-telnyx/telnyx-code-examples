# Inbound Call Webhook with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that receives and handles inbound call webhooks from the Telnyx Voice API. This tutorial demonstrates webhook validation, call state management, and proper error handling for telecom events using the Telnyx PHP SDK.

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
- Composer (PHP package manager).
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for inbound calls.
- A publicly accessible URL (ngrok, Cloudflare Tunnel, or deployed server) to receive webhooks.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/route-phone-calls-to-ai-agent-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/route-phone-calls-to-ai-agent-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a controller to handle inbound call webhooks:

```bash
php artisan make:controller CallWebhookController
```

Edit `app/Http/Controllers/CallWebhookController.php`:

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Telnyx\Client;

class CallWebhookController extends Controller
{
    /**
     * Handle inbound call webhook events from Telnyx.
     * 
     * Telnyx sends webhook events for call.initiated, call.answered, call.hangup, etc.
     * This handler logs the event and responds with 200 OK to acknowledge receipt.
     */
    public function handleInboundCall(Request $request): JsonResponse
    {
        // Extract the webhook payload
        $payload = $request->all();
        
        // Validate required fields
        if (!isset($payload['data']) || !isset($payload['data']['event_type'])) {
            return response()->json(['error' => 'Invalid webhook payload'], 400);
        }
        
        $eventType = $payload['data']['event_type'];
        $callData = $payload['data'];
        
        // Log the event for debugging and audit trails
        \Log::info('Inbound call webhook received', [
            'event_type' => $eventType,
            'call_control_id' => $callData['call_control_id'] ?? null,
            'from' => $callData['from'] ?? null,
            'to' => $callData['to'] ?? null,
        ]);
        
        // Handle different call events
        switch ($eventType) {
            case 'call.initiated':
                $this->handleCallInitiated($callData);
                break;
            case 'call.answered':
                $this->handleCallAnswered($callData);
                break;
            case 'call.hangup':
                $this->handleCallHangup($callData);
                break;
            case 'call.dtmf.received':
                $this->handleDTMFReceived($callData);
                break;
            default:
                \Log::warning('Unknown call event type', ['event_type' => $eventType]);
        }
        
        // Always return 200 OK to acknowledge webhook receipt
        return response()->json(['status' => 'received'], 200);
    }
    
    /**
     * Handle call.initiated event — inbound call has started.
     */
    private function handleCallInitiated(array $callData): void
    {
        $callControlId = $callData['call_control_id'] ?? null;
        $from = $callData['from'] ?? 'unknown';
        $to = $callData['to'] ?? 'unknown';
        
        \Log::info('Call initiated', [
            'call_control_id' => $callControlId,
            'from' => $from,
            'to' => $to,
        ]);
        
        // Store call metadata in cache or database for later retrieval
        if ($callControlId) {
            cache()->put("call:{$callControlId}", [
                'from' => $from,
                'to' => $to,
                'initiated_at' => now(),
                'status' => 'initiated',
            ], now()->addHours(1));
        }
    }
    
    /**
     * Handle call.answered event — inbound call has been answered.
     */
    private function handleCallAnswered(array $callData): void
    {
        $callControlId = $callData['call_control_id'] ?? null;
        
        \Log::info('Call answered', ['call_control_id' => $callControlId]);
        
        if ($callControlId) {
            $callInfo = cache()->get("call:{$callControlId}", []);
            $callInfo['status'] = 'answered';
            $callInfo['answered_at'] = now();
            cache()->put("call:{$callControlId}", $callInfo, now()->addHours(1));
        }
    }
    
    /**
     * Handle call.hangup event — inbound call has ended.
     */
    private function handleCallHangup(array $callData): void
    {
        $callControlId = $callData['call_control_id'] ?? null;
        $hangupReason = $callData['hangup_reason'] ?? 'unknown';
        
        \Log::info('Call hangup', [
            'call_control_id' => $callControlId,
            'hangup_reason' => $hangupReason,
        ]);
        
        if ($callControlId) {
            $callInfo = cache()->get("call:{$callControlId}", []);
            $callInfo['status'] = 'hangup';
            $callInfo['hangup_reason'] = $hangupReason;
            $callInfo['hangup_at'] = now();
            cache()->put("call:{$callControlId}", $callInfo, now()->addHours(1));
        }
    }
    
    /**
     * Handle call.dtmf.received event — DTMF digit collected during call.
     */
    private function handleDTMFReceived(array $callData): void
    {
        $callControlId = $callData['call_control_id'] ?? null;
        $digit = $callData['dtmf_digit'] ?? null;
        
        \Log::info('DTMF received', [
            'call_control_id' => $callControlId,
            'digit' => $digit,
        ]);
    }
    
    /**
     * Retrieve call status from cache.
     * 
     * This endpoint allows you to query the status of a previously initiated call.
     */
    public function getCallStatus(Request $request): JsonResponse
    {
        $callControlId = $request->query('call_control_id');
        
        if (!$callControlId) {
            return response()->json(['error' => 'call_control_id query parameter required'], 400);
        }
        
        $callInfo = cache()->get("call:{$callControlId}");
        
        if (!$callInfo) {
            return response()->json(['error' => 'Call not found'], 404);
        }
        
        return response()->json($callInfo, 200);
    }
}
```

Register the webhook route in `routes/api.php`:

```php
<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\CallWebhookController;

Route::post('/webhooks/call', [CallWebhookController::class, 'handleInboundCall']);
Route::get('/call-status', [CallWebhookController::class, 'getCallStatus']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not received | The endpoint is not receiving webhook events from Telnyx. | Verify that your public URL (from ngrok or your server) is correctly configured in the Telnyx Portal under your Call Control Application settings. Ensure the webhook URL is set to `https://your-domain.com/api/webhooks/call`. Check that your firewall and network allow inbound HTTPS traffic on port 443. Use ngrok's web interface (`http://localhost:4040`) to inspect incoming requests and confirm Telnyx is sending webhooks. |
| Invalid webhook payload | The endpoint returns `{"error": "Invalid webhook payload"}` with HTTP 400. | Verify that the webhook payload contains the required `data` and `data.event_type` fields. Check the Telnyx documentation for the exact structure of webhook payloads. Log the raw request body using `\Log::info($request->all())` to inspect the incoming data and ensure it matches the expected format. |
| Call status not found | Querying `/api/call-status?call_control_id=...` returns `{"error": "Call not found"}` with HTTP 404. | Ensure the `call_control_id` parameter is correct and matches the value from the webhook event. Verify that the call was initiated recently — cached data expires after 1 hour. Check that Laravel's cache driver is properly configured in `.env` (default is `CACHE_DRIVER=file`). If using a distributed system, ensure all servers share the same cache backend (Redis or Memcached). |

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

- [Make an Outbound Call with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/outbound-call).
- [Record Phone Calls with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/call-recording).
- [Transfer Calls with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/call-transfer).
