# Hold Music with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that places callers on hold with custom music using the Telnyx Voice API. This tutorial demonstrates the command-event model of Call Control, webhook handling for call state transitions, and proper audio streaming integration. You'll learn to initiate calls, answer incoming calls, start hold music playback, and manage call lifecycle events through webhooks.

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
- A Telnyx phone number enabled for outbound and inbound calls.
- A Call Control Application configured in the Telnyx Portal with a webhook URL.
- Composer (PHP package manager).
- A publicly accessible URL for webhook callbacks (use ngrok for local development).
- An audio file URL for hold music (MP3 or WAV format, publicly accessible).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/hold-music-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to encapsulate Telnyx API interactions. Generate a new service:

```bash
php artisan make:service TelnyxCallService
```

Edit `app/Services/TelnyxCallService.php`:

```php
<?php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;

class TelnyxCallService
{
    private Client $client;
    private string $phoneNumber;
    private string $connectionId;
    private string $holdMusicUrl;

    public function __construct()
    {
        $this->client = new Client(apiKey: config('services.telnyx.api_key'));
        $this->phoneNumber = config('services.telnyx.phone_number');
        $this->connectionId = config('services.telnyx.connection_id');
        $this->holdMusicUrl = config('services.telnyx.hold_music_url');
    }

    /**
     * Initiate an outbound call.
     * Returns call_control_id for subsequent control actions.
     */
    public function initiateCall(string $toNumber): array
    {
        if (!str_starts_with($toNumber, '+')) {
            throw new \InvalidArgumentException('Phone number must be in E.164 format (e.g., +15551234567)');
        }

        try {
            $response = $this->client->calls->dial(
                from_: $this->phoneNumber,
                to: $toNumber,
                connection_id: $this->connectionId,
            );

            // Extract serializable data — SDK objects are NOT JSON-serializable
            return [
                'call_control_id' => $response->data->call_control_id,
                'to' => $toNumber,
                'from' => $this->phoneNumber,
            ];
        } catch (ApiException $e) {
            throw new \RuntimeException('Failed to initiate call: ' . $e->getMessage());
        }
    }

    /**
     * Answer an incoming call.
     */
    public function answerCall(string $callControlId): array
    {
        try {
            $response = $this->client->calls->actions->answer(
                call_control_id: $callControlId,
            );

            return [
                'call_control_id' => $response->data->call_control_id,
                'state' => $response->data->state ?? 'answered',
            ];
        } catch (ApiException $e) {
            throw new \RuntimeException('Failed to answer call: ' . $e->getMessage());
        }
    }

    /**
     * Start playing hold music on a call.
     */
    public function startHoldMusic(string $callControlId): array
    {
        try {
            $response = $this->client->calls->actions->playback_start(
                call_control_id: $callControlId,
                audio_url: $this->holdMusicUrl,
                loop: true, // Loop the music continuously
            );

            return [
                'call_control_id' => $response->data->call_control_id,
                'playback_started' => true,
            ];
        } catch (ApiException $e) {
            throw new \RuntimeException('Failed to start hold music: ' . $e->getMessage());
        }
    }

    /**
     * Stop playing hold music on a call.
     */
    public function stopHoldMusic(string $callControlId): array
    {
        try {
            $response = $this->client->calls->actions->playback_stop(
                call_control_id: $callControlId,
            );

            return [
                'call_control_id' => $response->data->call_control_id,
                'playback_stopped' => true,
            ];
        } catch (ApiException $e) {
            throw new \RuntimeException('Failed to stop hold music: ' . $e->getMessage());
        }
    }

    /**
     * Hangup a call.
     */
    public function hangupCall(string $callControlId): array
    {
        try {
            $response = $this->client->calls->actions->hangup(
                call_control_id: $callControlId,
            );

            return [
                'call_control_id' => $response->data->call_control_id,
                'hangup_initiated' => true,
            ];
        } catch (ApiException $e) {
            throw new \RuntimeException('Failed to hangup call: ' . $e->getMessage());
        }
    }

    /**
     * Retrieve call status.
     */
    public function getCallStatus(string $callControlId): array
    {
        try {
            $response = $this->client->calls->retrieve_status(
                call_control_id: $callControlId,
            );

            return [
                'call_control_id' => $response->data->call_control_id,
                'state' => $response->data->state,
                'is_alive' => $response->data->is_alive,
            ];
        } catch (ApiException $e) {
            throw new \RuntimeException('Failed to retrieve call status: ' . $e->getMessage());
        }
    }
}
```

Create a controller to handle call initiation and webhook events. Generate a new controller:

```bash
php artisan make:controller CallController
```

Edit `app/Http/Controllers/CallController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\TelnyxCallService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;

class CallController extends Controller
{
    private TelnyxCallService $callService;

    public function __construct(TelnyxCallService $callService)
    {
        $this->callService = $callService;
    }

    /**
     * Initiate an outbound call with hold music.
     */
    public function initiateCall(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'to' => 'required|string|regex:/^\+\d{1,15}$/',
        ]);

        try {
            $result = $this->callService->initiateCall($validated['to']);
            return response()->json($result, 200);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Webhook endpoint to handle call events from Telnyx.
     * Processes call.initiated, call.answered, call.hangup events.
     */
    public function webhook(Request $request): JsonResponse
    {
        $payload = $request->all();

        // Verify webhook signature (optional but recommended for production)
        // Telnyx sends X-Telnyx-Signature-V2 header for verification

        $eventType = $payload['data']['event_type'] ?? null;
        $callControlId = $payload['data']['payload']['call_control_id'] ?? null;

        if (!$eventType || !$callControlId) {
            return response()->json(['status' => 'ignored'], 200);
        }

        try {
            switch ($eventType) {
                case 'call.initiated':
                    // Outbound call has been initiated
                    \Log::info('Call initiated', ['call_control_id' => $callControlId]);
                    break;

                case 'call.answered':
                    // Call has been answered — start hold music
                    \Log::info('Call answered, starting hold music', ['call_control_id' => $callControlId]);
                    $this->callService->startHoldMusic($callControlId);
                    break;

                case 'call.hangup':
                    // Call has ended — clean up resources
                    \Log::info('Call hangup', ['call_control_id' => $callControlId]);
                    break;

                default:
                    \Log::debug('Unhandled event type', ['event_type' => $eventType]);
            }

            return response()->json(['status' => 'processed'], 200);
        } catch (\RuntimeException $e) {
            \Log::error('Webhook processing error', ['error' => $e->getMessage()]);
            // Return 200 to acknowledge receipt; Telnyx will not retry
            return response()->json(['status' => 'error', 'message' => $e->getMessage()], 200);
        }
    }

    /**
     * Get the status of an active call.
     */
    public function getStatus(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'call_control_id' => 'required|string',
        ]);

        try {
            $result = $this->callService->getCallStatus($validated['call_control_id']);
            return response()->json($result, 200);
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Stop hold music and hangup a call.
     */
    public function hangupCall(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'call_control_id' => 'required|string',
        ]);

        try {
            $this->callService->stopHoldMusic($validated['call_control_id']);
            $result = $this->callService->hangupCall($validated['call_control_id']);
            return response()->json($result, 200);
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\CallController;
use Illuminate\Support\Facades\Route;

Route::post('/calls/initiate', [CallController::class, 'initiateCall']);
Route::post('/calls/status', [CallController::class, 'getStatus']);
Route::post('/calls/hangup', [CallController::class, 'hangupCall']);
Route::post('/webhooks/call', [CallController::class, 'webhook']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hold-music-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The API returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Laravel development server after updating `.env`. |
| Invalid Phone Number Format | You receive a 400 validation error or Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl commands to use properly formatted numbers. |
| Webhook Not Receiving Events | Call events are not triggering the webhook endpoint; logs show no incoming requests. | Verify your Call Control Application in the Telnyx Portal is configured with the correct webhook URL. If using ngrok, ensure the ngrok tunnel is active and the URL in your `.env` matches the ngrok URL. Check that your firewall allows inbound HTTPS traffic on port 443. Test webhook delivery using the Telnyx Portal's webhook testing tool. |
| Hold Music Not Playing | Call connects but no audio is heard; `startHoldMusic()` returns success. | Verify the `HOLD_MUSIC_URL` in `.env` points to a publicly accessible audio file (MP3 or WAV). Test the URL in a browser to confirm it downloads. Ensure the audio file is at least a few seconds long. Check Telnyx logs in the Portal for playback errors. Some audio formats may require transcoding—use a standard MP3 file. |
| Connection ID Not Found | API returns error about invalid or missing connection ID. | Confirm your `TELNYX_CONNECTION_ID` in `.env` matches the Call Control Application ID from the Telnyx Portal. The connection ID links your phone number to the Call Control application. Verify the application is active and associated with your Telnyx phone number. |

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

- [Implement an IVR Menu with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/ivr-menu).
- [Transfer Calls Between Agents with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/call-transfer).
- [Record Calls with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/call-recording).
