# Call Recording with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that initiates outbound calls and records them using the Telnyx Voice API. This tutorial demonstrates the new PHP SDK client initialization pattern, webhook handling for call lifecycle events, secure credential management via environment variables, and proper error handling for telecom APIs.

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
cd telnyx-code-examples/record-phone-calls-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/record-phone-calls-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to encapsulate call recording logic. Generate it using Artisan:

```bash
php artisan make:service CallRecordingService
```

Edit `app/Services/CallRecordingService.php`:

```php
<?php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;

class CallRecordingService
{
    private Client $client;
    private string $phoneNumber;
    private string $connectionId;

    public function __construct()
    {
        // Initialize Telnyx client with API key from environment
        $this->client = new Client(apiKey: getenv('TELNYX_API_KEY'));
        $this->phoneNumber = getenv('TELNYX_PHONE_NUMBER');
        $this->connectionId = getenv('TELNYX_CONNECTION_ID');

        if (!$this->phoneNumber || !$this->connectionId) {
            throw new \RuntimeException('Missing required Telnyx configuration');
        }
    }

    /**
     * Initiate an outbound call with recording enabled.
     *
     * @param string $toNumber Destination phone number in E.164 format
     * @return array Call details including call_control_id
     * @throws \Exception
     */
    public function initiateCallWithRecording(string $toNumber): array
    {
        // Validate E.164 format to prevent API errors
        if (!preg_match('/^\+\d{1,15}$/', $toNumber)) {
            throw new \InvalidArgumentException(
                'Phone number must be in E.164 format (e.g., +15551234567)'
            );
        }

        try {
            // Initiate outbound call via Telnyx API
            // connection_id is REQUIRED and links to your Call Control Application
            // Do NOT pass call_control_id to dial() — it is returned in the response
            $response = $this->client->calls->dial(
                from_: $this->phoneNumber,
                to: $toNumber,
                connection_id: $this->connectionId,
            );

            // Extract serializable data — SDK objects are NOT JSON-serializable
            return [
                'call_control_id' => $response->data->call_control_id,
                'from' => $this->phoneNumber,
                'to' => $toNumber,
                'status' => 'initiated',
            ];
        } catch (AuthenticationException $e) {
            throw new \Exception('Authentication failed: Invalid API key', 401);
        } catch (ApiException $e) {
            throw new \Exception('Telnyx API error: ' . $e->getMessage(), $e->getCode());
        }
    }

    /**
     * Start recording an active call.
     *
     * @param string $callControlId Call control ID returned from dial()
     * @param string $format Recording format (wav, mp3, ulaw)
     * @return array Recording start confirmation
     * @throws \Exception
     */
    public function startRecording(string $callControlId, string $format = 'wav'): array
    {
        if (!$callControlId) {
            throw new \InvalidArgumentException('call_control_id is required');
        }

        try {
            // Start recording on the active call
            $response = $this->client->calls->actions->start_recording(
                call_control_id: $callControlId,
                format: $format,
            );

            return [
                'call_control_id' => $response->data->call_control_id,
                'recording_started' => true,
                'format' => $format,
            ];
        } catch (ApiException $e) {
            throw new \Exception('Failed to start recording: ' . $e->getMessage(), $e->getCode());
        }
    }

    /**
     * Stop recording an active call.
     *
     * @param string $callControlId Call control ID
     * @return array Recording stop confirmation
     * @throws \Exception
     */
    public function stopRecording(string $callControlId): array
    {
        if (!$callControlId) {
            throw new \InvalidArgumentException('call_control_id is required');
        }

        try {
            // Stop recording on the active call
            $response = $this->client->calls->actions->stop_recording(
                call_control_id: $callControlId,
            );

            return [
                'call_control_id' => $response->data->call_control_id,
                'recording_stopped' => true,
            ];
        } catch (ApiException $e) {
            throw new \Exception('Failed to stop recording: ' . $e->getMessage(), $e->getCode());
        }
    }

    /**
     * Hang up an active call.
     *
     * @param string $callControlId Call control ID
     * @return array Hangup confirmation
     * @throws \Exception
     */
    public function hangupCall(string $callControlId): array
    {
        if (!$callControlId) {
            throw new \InvalidArgumentException('call_control_id is required');
        }

        try {
            // Terminate the call
            $response = $this->client->calls->actions->hangup(
                call_control_id: $callControlId,
            );

            return [
                'call_control_id' => $response->data->call_control_id,
                'hangup_initiated' => true,
            ];
        } catch (ApiException $e) {
            throw new \Exception('Failed to hangup call: ' . $e->getMessage(), $e->getCode());
        }
    }
}
```

Create a controller to handle HTTP requests. Generate it using Artisan:

```bash
php artisan make:controller CallRecordingController
```

Edit `app/Http/Controllers/CallRecordingController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\CallRecordingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;

class CallRecordingController extends Controller
{
    private CallRecordingService $recordingService;

    public function __construct(CallRecordingService $recordingService)
    {
        $this->recordingService = $recordingService;
    }

    /**
     * Initiate an outbound call with recording.
     */
    public function initiateCall(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'to' => 'required|string',
        ]);

        try {
            $result = $this->recordingService->initiateCallWithRecording($validated['to']);
            return response()->json($result, 200);
        } catch (AuthenticationException $e) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (ApiException $e) {
            return response()->json(
                ['error' => $e->getMessage()],
                $e->getCode() ?: 400
            );
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Start recording an active call.
     */
    public function startRecording(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'call_control_id' => 'required|string',
            'format' => 'nullable|string|in:wav,mp3,ulaw',
        ]);

        try {
            $result = $this->recordingService->startRecording(
                $validated['call_control_id'],
                $validated['format'] ?? 'wav'
            );
            return response()->json($result, 200);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Stop recording an active call.
     */
    public function stopRecording(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'call_control_id' => 'required|string',
        ]);

        try {
            $result = $this->recordingService->stopRecording($validated['call_control_id']);
            return response()->json($result, 200);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Hang up an active call.
     */
    public function hangupCall(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'call_control_id' => 'required|string',
        ]);

        try {
            $result = $this->recordingService->hangupCall($validated['call_control_id']);
            return response()->json($result, 200);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Handle incoming webhook events from Telnyx.
     */
    public function handleWebhook(Request $request): JsonResponse
    {
        $payload = $request->all();
        $eventType = $payload['data']['event_type'] ?? null;
        $callControlId = $payload['data']['call_control_id'] ?? null;

        // Log webhook events for debugging
        \Log::info('Telnyx webhook received', [
            'event_type' => $eventType,
            'call_control_id' => $callControlId,
        ]);

        // Handle different call lifecycle events
        switch ($eventType) {
            case 'call.initiated':
                // Call has been initiated — ready for recording
                \Log::info('Call initiated', ['call_control_id' => $callControlId]);
                break;

            case 'call.answered':
                // Call has been answered — safe to start recording
                \Log::info('Call answered', ['call_control_id' => $callControlId]);
                break;

            case 'call.recording.saved':
                // Recording has been saved and is available for download
                $recordingUrl = $payload['data']['recording_urls']['wav'] ?? null;
                \Log::info('Recording saved', [
                    'call_control_id' => $callControlId,
                    'recording_url' => $recordingUrl,
                ]);
                break;

            case 'call.hangup':
                // Call has ended — clean up resources
                \Log::info('Call ended', ['call_control_id' => $callControlId]);
                break;

            default:
                \Log::debug('Unhandled webhook event', ['event_type' => $eventType]);
        }

        // Always return 200 OK to acknowledge receipt
        return response()->json(['status' => 'received'], 200);
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\CallRecordingController;
use Illuminate\Support\Facades\Route;

Route::post('/calls/initiate', [CallRecordingController::class, 'initiateCall']);
Route::post('/calls/recording/start', [CallRecordingController::class, 'startRecording']);
Route::post('/calls/recording/stop', [CallRecordingController::class, 'stopRecording']);
Route::post('/calls/hangup', [CallRecordingController::class, 'hangupCall']);
Route::post('/webhooks/call', [CallRecordingController::class, 'handleWebhook']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Laravel server with `php artisan serve`. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Missing Connection ID | The application raises `RuntimeException: Missing required Telnyx configuration` on startup or first request. | Confirm your `.env` file contains `TELNYX_CONNECTION_ID` with your Call Control Application ID from the Telnyx Portal. The connection ID links your phone number to your Call Control Application. Verify the value is not empty and restart the Laravel server. |
| Webhooks Not Received | Call events are not appearing in the logs, or webhook handler is never called. | Ensure your webhook URL in the Telnyx Portal matches your ngrok URL or public domain. Use ngrok to expose your local server: `ngrok http 8000`. Update `WEBHOOK_URL` in `.env` to the ngrok URL and restart the server. Verify the webhook URL is publicly accessible by visiting it in a browser (you should see a 405 Method Not Allowed error, which is expected). |
| Recording Not Starting | The `startRecording` endpoint returns an error or recording does not appear in webhooks. | Ensure the call has been answered before starting recording. The `call.answered` webhook must be received first. Verify the `call_control_id` is correct and matches the ID from the `initiateCall` response. Check that your Call Control Application has recording permissions enabled in the Telnyx Portal. |

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

- [Handle Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/inbound-call-webhook).
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/call-transfer).
- [Build an Interactive Voice Response (IVR) Menu](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/ivr-menu).
