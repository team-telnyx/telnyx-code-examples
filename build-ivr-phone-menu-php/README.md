# Ivr Menu with PHP and Laravel

## What Does This Example Do?

Build a production-ready Interactive Voice Response (IVR) system using Laravel and the Telnyx Voice API. This tutorial demonstrates how to handle inbound calls, play voice prompts, collect DTMF (dial tone) input, and route calls based on user selections. You'll implement a complete call control flow with webhook handling, state management, and proper error handling for a real-world IVR application.

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
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).
- Basic understanding of Laravel routing and middleware.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-ivr-phone-menu-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-ivr-phone-menu-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a controller to handle IVR logic:

```bash
php artisan make:controller IvrController
```

Edit `app/Http/Controllers/IvrController.php`:

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Telnyx\Client;
use Telnyx\Exception\ApiErrorException;

class IvrController extends Controller
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client(apiKey: env('TELNYX_API_KEY'));
    }

    /**
     * Handle inbound call webhook — call.initiated event.
     * Answer the call and play initial prompt.
     */
    public function handleInboundCall(Request $request): JsonResponse
    {
        $payload = $request->all();
        $callControlId = $payload['data']['payload']['call_control_id'] ?? null;

        if (!$callControlId) {
            return response()->json(['error' => 'Missing call_control_id'], 400);
        }

        try {
            // Answer the inbound call
            $this->client->calls->actions->answer(
                $callControlId,
                []
            );

            // Play initial IVR prompt after a brief delay
            $this->client->calls->actions->speak(
                $callControlId,
                [
                    'payload' => 'Welcome to our IVR system. Press 1 for sales, 2 for support, or 3 to repeat this menu.',
                    'language' => 'en-US',
                    'voice' => 'female',
                ]
            );

            return response()->json(['status' => 'call answered and prompt played'], 200);

        } catch (ApiErrorException $e) {
            return response()->json(
                ['error' => 'Failed to answer call: ' . $e->getMessage()],
                $e->getHttpStatus() ?? 500
            );
        }
    }

    /**
     * Handle DTMF input webhook — call.dtmf.received event.
     * Route based on digit pressed.
     */
    public function handleDtmfInput(Request $request): JsonResponse
    {
        $payload = $request->all();
        $callControlId = $payload['data']['payload']['call_control_id'] ?? null;
        $digit = $payload['data']['payload']['digit'] ?? null;

        if (!$callControlId || !$digit) {
            return response()->json(['error' => 'Missing call_control_id or digit'], 400);
        }

        try {
            match ($digit) {
                '1' => $this->routeToSales($callControlId),
                '2' => $this->routeToSupport($callControlId),
                '3' => $this->playMainMenu($callControlId),
                default => $this->playInvalidInput($callControlId),
            };

            return response()->json(['status' => 'DTMF processed', 'digit' => $digit], 200);

        } catch (ApiErrorException $e) {
            return response()->json(
                ['error' => 'Failed to process DTMF: ' . $e->getMessage()],
                $e->getHttpStatus() ?? 500
            );
        }
    }

    /**
     * Route caller to sales department.
     */
    private function routeToSales(string $callControlId): void
    {
        $this->client->calls->actions->speak(
            $callControlId,
            [
                'payload' => 'You have selected sales. Transferring you now.',
                'language' => 'en-US',
                'voice' => 'female',
            ]
        );

        // Transfer to sales number (replace with actual sales number)
        $this->client->calls->actions->transfer(
            $callControlId,
            [
                'to' => '+15551234567',
                'from' => env('TELNYX_PHONE_NUMBER'),
            ]
        );
    }

    /**
     * Route caller to support department.
     */
    private function routeToSupport(string $callControlId): void
    {
        $this->client->calls->actions->speak(
            $callControlId,
            [
                'payload' => 'You have selected support. Transferring you now.',
                'language' => 'en-US',
                'voice' => 'female',
            ]
        );

        // Transfer to support number (replace with actual support number)
        $this->client->calls->calls->actions->transfer(
            $callControlId,
            [
                'to' => '+15559876543',
                'from' => env('TELNYX_PHONE_NUMBER'),
            ]
        );
    }

    /**
     * Replay the main menu.
     */
    private function playMainMenu(string $callControlId): void
    {
        $this->client->calls->actions->speak(
            $callControlId,
            [
                'payload' => 'Welcome to our IVR system. Press 1 for sales, 2 for support, or 3 to repeat this menu.',
                'language' => 'en-US',
                'voice' => 'female',
            ]
        );
    }

    /**
     * Handle invalid DTMF input.
     */
    private function playInvalidInput(string $callControlId): void
    {
        $this->client->calls->actions->speak(
            $callControlId,
            [
                'payload' => 'Invalid selection. Please press 1 for sales, 2 for support, or 3 to repeat this menu.',
                'language' => 'en-US',
                'voice' => 'female',
            ]
        );
    }

    /**
     * Handle call hangup webhook — call.hangup event.
     * Clean up resources and log call completion.
     */
    public function handleCallHangup(Request $request): JsonResponse
    {
        $payload = $request->all();
        $callControlId = $payload['data']['payload']['call_control_id'] ?? null;
        $hangupReason = $payload['data']['payload']['hangup_reason'] ?? 'unknown';

        // Log call completion (implement your logging logic here)
        \Log::info('Call ended', [
            'call_control_id' => $callControlId,
            'reason' => $hangupReason,
        ]);

        return response()->json(['status' => 'call logged'], 200);
    }
}
```

Register the webhook routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\IvrController;
use Illuminate\Support\Facades\Route;

Route::post('/webhooks/call/inbound', [IvrController::class, 'handleInboundCall']);
Route::post('/webhooks/call/dtmf', [IvrController::class, 'handleDtmfInput']);
Route::post('/webhooks/call/hangup', [IvrController::class, 'handleCallHangup']);
```

Create a service class to manage call state (optional but recommended for production):

```bash
php artisan make:class Services/CallStateService
```

Edit `app/Services/CallStateService.php`:

```php
<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;

class CallStateService
{
    /**
     * Store call state in cache for the duration of the call.
     */
    public function setState(string $callControlId, array $state): void
    {
        Cache::put("call_state:{$callControlId}", $state, now()->addHours(1));
    }

    /**
     * Retrieve call state.
     */
    public function getState(string $callControlId): ?array
    {
        return Cache::get("call_state:{$callControlId}");
    }

    /**
     * Clear call state when call ends.
     */
    public function clearState(string $callControlId): void
    {
        Cache::forget("call_state:{$callControlId}");
    }
}
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhooks not being received | Your Laravel application is not receiving webhook POST requests from Telnyx. | Verify that your ngrok URL is correctly configured in the Telnyx Portal webhook settings. Ensure your `.env` file has the correct `APP_URL`. Check that your firewall or network allows inbound HTTPS traffic on port 443. Use `ngrok http 8000` to expose your local server and verify the tunnel is active with `ngrok status`. |
| Call not answering or speaking | The inbound call webhook is received but the call does not answer or play audio. | Verify that your `TELNYX_API_KEY` and `TELNYX_CONNECTION_ID` are correct in the `.env` file. Ensure the `call_control_id` is being extracted correctly from the webhook payload. Check Laravel logs with `tail -f storage/logs/laravel.log` for API errors. Confirm your Telnyx phone number is enabled for inbound calls in the Portal. |
| DTMF input not being detected | Callers press digits but the `call.dtmf.received` webhook is not triggered. | Verify that DTMF collection is enabled on your Telnyx Call Control Application in the Portal. Ensure the webhook URL for DTMF events is configured correctly. Check that the `speak` action includes a prompt that instructs callers to press digits. Some carriers may not support DTMF reliably; test with a different phone number or carrier if possible. |
| Transfer fails with API error | The transfer action returns an error like "Invalid destination" or "Transfer failed". | Verify that the destination phone number is in E.164 format (e.g., `+15551234567`). Ensure the `from` parameter matches your Telnyx phone number. Check that the destination number is reachable and not blocked. Confirm your Telnyx account has outbound calling enabled for the destination country. |
| 401 Unauthorized error | API calls return a 401 error indicating authentication failure. | Verify your `TELNYX_API_KEY` in the `.env` file is correct and matches the key in the Telnyx Portal. Ensure there are no trailing spaces or special characters in the API key. Regenerate the API key in the Portal if necessary and update your `.env` file. Restart the Laravel development server after updating credentials. |

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
- [Record and Store Call Audio](/tutorials/voice/php/call-recording).
- [Transfer Calls Between Numbers](/tutorials/voice/php/call-transfer).
