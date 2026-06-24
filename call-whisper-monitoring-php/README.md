# Whisper Prompt with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that initiates outbound calls with a whisper prompt—a message played to the caller before the call connects to the recipient. This tutorial demonstrates the Telnyx Voice API's call control capabilities, webhook event handling, and secure credential management using Laravel's environment configuration.

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
cd telnyx-code-examples/call-whisper-monitoring-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a controller to handle call initiation and webhook events:

```bash
php artisan make:controller CallController
```

Edit `app/Http/Controllers/CallController.php`:

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Telnyx\Client;
use Telnyx\Exception\ApiErrorException;

class CallController extends Controller
{
    private Client $client;

    public function __construct()
    {
        // Initialize Telnyx client with API key from environment
        $this->client = new Client(apiKey: getenv('TELNYX_API_KEY'));
    }

    /**
     * Initiate an outbound call with a whisper prompt.
     * The whisper prompt is played to the caller before the call connects.
     */
    public function initiateCall(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'to' => 'required|string|regex:/^\+\d{1,15}$/',
            'whisper_text' => 'required|string|max:500',
        ]);

        $toNumber = $validated['to'];
        $whisperText = $validated['whisper_text'];
        $fromNumber = config('services.telnyx.phone_number');
        $connectionId = config('services.telnyx.connection_id');

        try {
            // Initiate the call using the Telnyx SDK
            $response = $this->client->calls->dial(
                from_: $fromNumber,
                to: $toNumber,
                connection_id: $connectionId,
                custom_headers: [
                    [
                        'name' => 'X-Whisper-Text',
                        'value' => $whisperText,
                    ],
                ],
            );

            // Extract and return serializable call data
            return response()->json([
                'call_control_id' => $response->data->call_control_id,
                'from' => $fromNumber,
                'to' => $toNumber,
                'whisper_text' => $whisperText,
                'status' => 'initiated',
            ], 201);

        } catch (ApiErrorException $e) {
            // Handle Telnyx API errors
            return $this->handleApiError($e);
        }
    }

    /**
     * Handle incoming webhook events from Telnyx.
     * Events include: call.initiated, call.answered, call.hangup, etc.
     */
    public function handleWebhook(Request $request): JsonResponse
    {
        $event = $request->input('data.event_type');
        $callControlId = $request->input('data.payload.call_control_id');

        // Log the event for debugging
        \Log::info('Telnyx webhook received', [
            'event' => $event,
            'call_control_id' => $callControlId,
        ]);

        switch ($event) {
            case 'call.initiated':
                return $this->handleCallInitiated($request);
            case 'call.answered':
                return $this->handleCallAnswered($request);
            case 'call.hangup':
                return $this->handleCallHangup($request);
            default:
                return response()->json(['status' => 'acknowledged'], 200);
        }
    }

    /**
     * Handle call.initiated event — call has been created.
     */
    private function handleCallInitiated(Request $request): JsonResponse
    {
        $callControlId = $request->input('data.payload.call_control_id');
        $from = $request->input('data.payload.from.phone_number');
        $to = $request->input('data.payload.to.phone_number');

        \Log::info('Call initiated', [
            'call_control_id' => $callControlId,
            'from' => $from,
            'to' => $to,
        ]);

        return response()->json(['status' => 'acknowledged'], 200);
    }

    /**
     * Handle call.answered event — recipient has answered.
     * Play the whisper prompt to the caller.
     */
    private function handleCallAnswered(Request $request): JsonResponse
    {
        $callControlId = $request->input('data.payload.call_control_id');
        $whisperText = $request->input('data.payload.custom_headers.0.value', 'Hello, your call is connected.');

        try {
            // Speak the whisper prompt to the caller
            $this->client->calls->actions->speak(
                call_control_id: $callControlId,
                payload: [
                    'text' => $whisperText,
                    'language' => 'en-US',
                    'voice' => 'female',
                ],
            );

            \Log::info('Whisper prompt played', [
                'call_control_id' => $callControlId,
                'text' => $whisperText,
            ]);

        } catch (ApiErrorException $e) {
            \Log::error('Failed to play whisper prompt', [
                'call_control_id' => $callControlId,
                'error' => $e->getMessage(),
            ]);
        }

        return response()->json(['status' => 'acknowledged'], 200);
    }

    /**
     * Handle call.hangup event — call has ended.
     */
    private function handleCallHangup(Request $request): JsonResponse
    {
        $callControlId = $request->input('data.payload.call_control_id');
        $hangupReason = $request->input('data.payload.hangup_reason', 'unknown');

        \Log::info('Call ended', [
            'call_control_id' => $callControlId,
            'reason' => $hangupReason,
        ]);

        return response()->json(['status' => 'acknowledged'], 200);
    }

    /**
     * Handle Telnyx API errors and map to HTTP status codes.
     */
    private function handleApiError(ApiErrorException $e): JsonResponse
    {
        $statusCode = $e->getHttpStatus() ?? 500;
        $message = $e->getMessage();

        // Map common Telnyx errors to HTTP status codes
        if (str_contains($message, 'Unauthorized')) {
            $statusCode = 401;
            $message = 'Invalid API key';
        } elseif (str_contains($message, 'Rate limit')) {
            $statusCode = 429;
            $message = 'Rate limit exceeded. Please slow down.';
        }

        return response()->json([
            'error' => $message,
            'status_code' => $statusCode,
        ], $statusCode);
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\CallController;
use Illuminate\Support\Facades\Route;

Route::post('/calls/initiate', [CallController::class, 'initiateCall']);
Route::post('/webhooks/call', [CallController::class, 'handleWebhook']);
```

Disable CSRF protection for the webhook route in `app/Http/Middleware/VerifyCsrfToken.php`:

```php
<?php

namespace App\Http\Middleware;

use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken as Middleware;

class VerifyCsrfToken extends Middleware
{
    /**
     * The URIs that should be excluded from CSRF verification.
     *
     * @var array<int, string>
     */
    protected $except = [
        'webhooks/call',
    ];
}
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-whisper-monitoring-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Laravel development server after updating the `.env` file. |
| Invalid Phone Number Format | You receive a 422 validation error stating the phone number format is invalid. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Events Not Received | The webhook endpoint is not receiving events from Telnyx, or logs show no incoming requests. | Verify that your `WEBHOOK_URL` in `.env` is publicly accessible and matches the webhook URL configured in your Call Control Application in the Telnyx Portal. If testing locally, use ngrok to expose your server and update the webhook URL. Ensure the webhook route is excluded from CSRF protection in `VerifyCsrfToken.php`. |
| Call Control ID Not Found | Attempting to control a call returns an error about an invalid or missing call control ID. | Ensure the `call_control_id` returned from the `initiateCall` endpoint is being used correctly in subsequent API calls. The `call_control_id` is unique per call and is returned in the response after initiating the call. Do not confuse it with `TELNYX_CONNECTION_ID`, which is a static configuration value. |
| Whisper Prompt Not Playing | The call connects but the whisper prompt is not heard by the caller. | Verify that the `call.answered` webhook event is being received and processed. Check the Laravel logs to confirm the `speak` action is being called. Ensure the `whisper_text` parameter is not empty and contains valid text. Test with a shorter, simpler message first to isolate the issue. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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

- [Handle Inbound Call Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/inbound-call-webhook).
- [Record Phone Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/call-recording).
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/call-transfer).
