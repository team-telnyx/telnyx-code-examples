# Text To Speech with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that plays text-to-speech (TTS) messages during voice calls using the Telnyx Voice API. This tutorial demonstrates the PHP SDK client initialization pattern, webhook handling for call events, proper error handling for telecom APIs, and secure credential management via environment variables.

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
- A Telnyx phone number enabled for outbound calls.
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).
- A Call Control Application configured in the Telnyx Portal with your webhook URL.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-to-speech-phone-call-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-to-speech-phone-call-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a controller to handle call initiation and TTS playback:

```bash
php artisan make:controller CallController
```

Edit `app/Http/Controllers/CallController.php`:

```php
<?php

namespace App\Http\Controllers;

use Telnyx\Client;
use Telnyx\Exception\ApiErrorException;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class CallController extends Controller
{
    private Client $client;

    public function __construct()
    {
        // Initialize Telnyx client with API key from environment
        $this->client = new Client(apiKey: getenv('TELNYX_API_KEY'));
    }

    /**
     * Initiate an outbound call with text-to-speech.
     * 
     * @param Request $request
     * @return JsonResponse
     */
    public function initiateCall(Request $request): JsonResponse
    {
        // Validate incoming request
        $validated = $request->validate([
            'to' => 'required|string|regex:/^\+\d{1,15}$/',
            'message' => 'required|string|max:1000',
        ]);

        $toNumber = $validated['to'];
        $message = $validated['message'];
        $fromNumber = config('services.telnyx.phone_number');
        $connectionId = config('services.telnyx.connection_id');

        if (!$fromNumber || !$connectionId) {
            return response()->json([
                'error' => 'Missing required configuration: TELNYX_PHONE_NUMBER or TELNYX_CONNECTION_ID',
            ], 500);
        }

        try {
            // Initiate the outbound call
            $response = $this->client->calls->dial(
                from_: $fromNumber,
                to: $toNumber,
                connection_id: $connectionId,
            );

            // Extract call_control_id from response for future control actions
            $callControlId = $response->data->call_control_id;

            // Store call metadata in session or database for webhook handling
            session(['call_' . $callControlId => [
                'to' => $toNumber,
                'message' => $message,
                'initiated_at' => now(),
            ]]);

            return response()->json([
                'call_control_id' => $callControlId,
                'status' => 'initiated',
                'to' => $toNumber,
            ], 200);

        } catch (\Exception $e) {
            return $this->handleException($e);
        }
    }

    /**
     * Handle webhook events from Telnyx (call.answered, call.hangup, etc.).
     * 
     * @param Request $request
     * @return JsonResponse
     */
    public function handleWebhook(Request $request): JsonResponse
    {
        $payload = $request->all();
        $eventType = $payload['data']['event_type'] ?? null;
        $callControlId = $payload['data']['call_control_id'] ?? null;

        if (!$eventType || !$callControlId) {
            return response()->json(['error' => 'Invalid webhook payload'], 400);
        }

        try {
            // Retrieve stored call metadata
            $callData = session('call_' . $callControlId, []);
            $message = $callData['message'] ?? 'Hello, this is a test message.';

            switch ($eventType) {
                case 'call.answered':
                    // Call was answered — play TTS message
                    $this->playTTS($callControlId, $message);
                    break;

                case 'call.speak.ended':
                    // TTS playback finished — hang up the call
                    $this->hangupCall($callControlId);
                    break;

                case 'call.hangup':
                    // Call ended — clean up session data
                    session()->forget('call_' . $callControlId);
                    break;

                default:
                    // Log other events for debugging
                    \Log::info('Unhandled webhook event', ['event_type' => $eventType]);
            }

            return response()->json(['status' => 'received'], 200);

        } catch (\Exception $e) {
            \Log::error('Webhook processing error', ['error' => $e->getMessage()]);
            return response()->json(['error' => 'Webhook processing failed'], 500);
        }
    }

    /**
     * Play text-to-speech message on an active call.
     * 
     * @param string $callControlId
     * @param string $message
     * @return void
     */
    private function playTTS(string $callControlId, string $message): void
    {
        try {
            $this->client->calls->actions->speak(
                call_control_id: $callControlId,
                payload: [
                    'text' => $message,
                    'language' => 'en-US',
                    'voice' => 'female',
                ],
            );
        } catch (\Exception $e) {
            \Log::error('TTS playback failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Hang up an active call.
     * 
     * @param string $callControlId
     * @return void
     */
    private function hangupCall(string $callControlId): void
    {
        try {
            $this->client->calls->actions->hangup(
                call_control_id: $callControlId,
            );
        } catch (\Exception $e) {
            \Log::error('Hangup failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Handle Telnyx API exceptions and return appropriate HTTP responses.
     * 
     * @param \Exception $e
     * @return JsonResponse
     */
    private function handleException(\Exception $e): JsonResponse
    {
        if ($e instanceof \Telnyx\Exception\AuthenticationException) {
            return response()->json(['error' => 'Invalid API key'], 401);
        }

        if ($e instanceof \Telnyx\Exception\RateLimitException) {
            return response()->json(['error' => 'Rate limit exceeded. Please slow down.'], 429);
        }

        if ($e instanceof ApiErrorException) {
            return response()->json([
                'error' => $e->getMessage(),
                'status_code' => $e->getHttpStatus(),
            ], $e->getHttpStatus() ?? 400);
        }

        if ($e instanceof \Telnyx\Exception\ApiConnectionException) {
            return response()->json(['error' => 'Network error connecting to Telnyx'], 503);
        }

        return response()->json(['error' => 'An unexpected error occurred'], 500);
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\CallController;
use Illuminate\Support\Facades\Route;

Route::post('/calls/initiate', [CallController::class, 'initiateCall']);
Route::post('/webhooks/telnyx', [CallController::class, 'handleWebhook']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/text-to-speech-phone-call-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Laravel server with `php artisan serve`. |
| Invalid Phone Number Format | You receive a 422 validation error or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Not Triggering | The call initiates but TTS does not play and no webhook events are received. | Confirm your ngrok URL is correctly configured in the Telnyx Portal Call Control Application webhook settings. Verify the webhook URL is `https://your-ngrok-url.ngrok.io/api/webhooks/telnyx`. Check Laravel logs with `tail -f storage/logs/laravel.log` to see if webhook requests are arriving. Ensure your firewall allows inbound HTTPS traffic on port 8000. |
| Missing Configuration Error | The endpoint returns a 500 error about missing `TELNYX_PHONE_NUMBER` or `TELNYX_CONNECTION_ID`. | Confirm your `.env` file exists in the project root and contains all three required variables: `TELNYX_API_KEY`, `TELNYX_PHONE_NUMBER`, and `TELNYX_CONNECTION_ID`. Run `php artisan config:cache` to refresh cached configuration. Restart the Laravel server after updating `.env`. |
| TTS Message Not Playing | The call connects but no audio is heard. | Verify the `message` parameter in your request is not empty and is under 1000 characters. Check that the `language` and `voice` parameters in the `playTTS()` method are valid (e.g., `en-US` with `female` or `male`). Review Laravel logs for TTS playback errors. Test with a shorter, simpler message first. |

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

- [Handle Inbound Call Webhooks with PHP](/tutorials/voice/php/inbound-call-webhook).
- [Record Voice Calls with PHP](/tutorials/voice/php/call-recording).
- [Transfer Calls Between Numbers with PHP](/tutorials/voice/php/call-transfer).
