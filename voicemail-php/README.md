# Voicemail with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that captures voicemail messages using the Telnyx Voice API. This tutorial demonstrates how to handle inbound calls, record audio, store voicemail metadata, and retrieve recordings using the Telnyx PHP SDK with proper webhook handling, error management, and database persistence.

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
- A Call Control Application configured in the Telnyx Portal.
- Composer (PHP package manager).
- A publicly accessible URL for webhooks (ngrok or similar for local development).
- SQLite or MySQL database configured in your Laravel `.env`.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voicemail-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle voicemail logic:

```bash
php artisan make:class Services/VoicemailService
```

Edit `app/Services/VoicemailService.php`:

```php
<?php

namespace App\Services;

use App\Models\Voicemail;
use Telnyx\Client;
use Telnyx\Exception\ApiErrorException;

class VoicemailService
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client(apiKey: config('telnyx.api_key'));
    }

    /**
     * Answer an inbound call and start recording voicemail.
     */
    public function answerAndRecord(string $callControlId): array
    {
        try {
            // Answer the call
            $this->client->calls->actions->answer(
                $callControlId,
                []
            );

            // Speak greeting message
            $this->client->calls->actions->speak(
                $callControlId,
                [
                    'payload' => 'Please leave your message after the beep.',
                    'language' => 'en-US',
                    'voice' => 'female',
                ]
            );

            // Start recording
            $recordingResponse = $this->client->calls->actions->startRecording(
                $callControlId,
                [
                    'format' => 'wav',
                    'channels' => 'mono',
                ]
            );

            return [
                'success' => true,
                'message' => 'Call answered and recording started',
                'recording_id' => $recordingResponse->data->recordingId ?? null,
            ];
        } catch (ApiErrorException $e) {
            return [
                'success' => false,
                'error' => $e->getMessage(),
                'status_code' => $e->getHttpStatus(),
            ];
        }
    }

    /**
     * Stop recording and hangup the call.
     */
    public function stopRecordingAndHangup(string $callControlId): array
    {
        try {
            // Stop recording
            $this->client->calls->actions->stopRecording($callControlId, []);

            // Hangup the call
            $this->client->calls->actions->hangup($callControlId, []);

            return [
                'success' => true,
                'message' => 'Recording stopped and call ended',
            ];
        } catch (ApiErrorException $e) {
            return [
                'success' => false,
                'error' => $e->getMessage(),
                'status_code' => $e->getHttpStatus(),
            ];
        }
    }

    /**
     * Retrieve call status and details.
     */
    public function getCallStatus(string $callControlId): array
    {
        try {
            $response = $this->client->calls->retrieveStatus($callControlId);

            return [
                'call_control_id' => $response->data->callControlId,
                'is_alive' => $response->data->isAlive,
                'state' => $response->data->state ?? 'unknown',
            ];
        } catch (ApiErrorException $e) {
            return [
                'success' => false,
                'error' => $e->getMessage(),
                'status_code' => $e->getHttpStatus(),
            ];
        }
    }

    /**
     * Create a voicemail record in the database.
     */
    public function createVoicemailRecord(array $data): Voicemail
    {
        return Voicemail::create($data);
    }

    /**
     * Update voicemail record with recording details.
     */
    public function updateVoicemailRecord(string $callControlId, array $data): ?Voicemail
    {
        return Voicemail::where('call_control_id', $callControlId)->update($data)
            ? Voicemail::where('call_control_id', $callControlId)->first()
            : null;
    }

    /**
     * Retrieve all voicemails.
     */
    public function getAllVoicemails(): array
    {
        return Voicemail::orderBy('created_at', 'desc')->get()->toArray();
    }

    /**
     * Retrieve a single voicemail by ID.
     */
    public function getVoicemailById(int $id): ?array
    {
        $voicemail = Voicemail::find($id);
        return $voicemail ? $voicemail->toArray() : null;
    }
}
```

Create a controller to handle webhook events:

```bash
php artisan make:controller WebhookController
```

Edit `app/Http/Controllers/WebhookController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Models\Voicemail;
use App\Services\VoicemailService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class WebhookController extends Controller
{
    private VoicemailService $voicemailService;

    public function __construct(VoicemailService $voicemailService)
    {
        $this->voicemailService = $voicemailService;
    }

    /**
     * Handle inbound voice webhooks from Telnyx.
     */
    public function handleVoiceWebhook(Request $request): JsonResponse
    {
        try {
            $payload = $request->json()->all();
            $eventType = $payload['data']['event_type'] ?? null;
            $callControlId = $payload['data']['call_control_id'] ?? null;

            if (!$callControlId) {
                return response()->json(['error' => 'Missing call_control_id'], 400);
            }

            match ($eventType) {
                'call.initiated' => $this->handleCallInitiated($payload),
                'call.answered' => $this->handleCallAnswered($payload),
                'call.hangup' => $this->handleCallHangup($payload),
                'call.recording.saved' => $this->handleRecordingSaved($payload),
                default => null,
            };

            return response()->json(['status' => 'received'], 200);
        } catch (\Exception $e) {
            \Log::error('Webhook error: ' . $e->getMessage());
            return response()->json(['error' => 'Internal server error'], 500);
        }
    }

    /**
     * Handle call.initiated event — create voicemail record.
     */
    private function handleCallInitiated(array $payload): void
    {
        $data = $payload['data'];
        $callControlId = $data['call_control_id'];
        $fromNumber = $data['from'] ?? 'unknown';
        $toNumber = $data['to'] ?? config('telnyx.phone_number');

        $this->voicemailService->createVoicemailRecord([
            'call_control_id' => $callControlId,
            'from_number' => $fromNumber,
            'to_number' => $toNumber,
            'status' => 'initiated',
        ]);
    }

    /**
     * Handle call.answered event — answer and start recording.
     */
    private function handleCallAnswered(array $payload): void
    {
        $callControlId = $payload['data']['call_control_id'];

        $result = $this->voicemailService->answerAndRecord($callControlId);

        if ($result['success']) {
            $this->voicemailService->updateVoicemailRecord($callControlId, [
                'status' => 'recording',
                'recording_id' => $result['recording_id'] ?? null,
            ]);
        }
    }

    /**
     * Handle call.hangup event — stop recording and mark as completed.
     */
    private function handleCallHangup(array $payload): void
    {
        $callControlId = $payload['data']['call_control_id'];

        $this->voicemailService->stopRecordingAndHangup($callControlId);

        $this->voicemailService->updateVoicemailRecord($callControlId, [
            'status' => 'completed',
        ]);
    }

    /**
     * Handle call.recording.saved event — store recording URL.
     */
    private function handleRecordingSaved(array $payload): void
    {
        $data = $payload['data'];
        $callControlId = $data['call_control_id'];
        $recordingUrl = $data['recording_url'] ?? null;
        $durationSeconds = $data['duration_seconds'] ?? null;

        $this->voicemailService->updateVoicemailRecord($callControlId, [
            'recording_url' => $recordingUrl,
            'duration_seconds' => $durationSeconds,
        ]);
    }
}
```

Create a controller for voicemail management endpoints:

```bash
php artisan make:controller VoicemailController
```

Edit `app/Http/Controllers/VoicemailController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\VoicemailService;
use Illuminate\Http\JsonResponse;

class VoicemailController extends Controller
{
    private VoicemailService $voicemailService;

    public function __construct(VoicemailService $voicemailService)
    {
        $this->voicemailService = $voicemailService;
    }

    /**
     * List all voicemails.
     */
    public function index(): JsonResponse
    {
        try {
            $voicemails = $this->voicemailService->getAllVoicemails();
            return response()->json($voicemails, 200);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Get a single voicemail by ID.
     */
    public function show(int $id): JsonResponse
    {
        try {
            $voicemail = $this->voicemailService->getVoicemailById($id);

            if (!$voicemail) {
                return response()->json(['error' => 'Voicemail not found'], 404);
            }

            return response()->json($voicemail, 200);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }
}
```

Register routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\WebhookController;
use App\Http\Controllers\VoicemailController;
use Illuminate\Support\Facades\Route;

Route::post('/webhooks/voice', [WebhookController::class, 'handleVoiceWebhook']);

Route::get('/voicemails', [VoicemailController::class, 'index']);
Route::get('/voicemails/{id}', [VoicemailController::class, 'show']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voicemail-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | The application does not receive `call.initiated` or other voice events from Telnyx. | Verify that the webhook URL in your Call Control Application settings matches the `WEBHOOK_URL` in your `.env` file exactly. Ensure the URL is publicly accessible (test with `curl https://your-url/api/webhooks/voice`). Check Laravel logs with `tail -f storage/logs/laravel.log` for incoming requests. If using ngrok, confirm the tunnel is active and the URL hasn't changed. |
| Recording URL is null | Voicemail records are created but `recording_url` remains null after the call ends. | Ensure the `call.recording.saved` webhook event is being received. This event is sent asynchronously after the recording is processed by Telnyx (typically 10–30 seconds after the call ends). Check your webhook logs to confirm the event arrived. If the event is missing, verify that recording is actually starting by checking the `call.answered` handler logs. |
| API authentication fails | The application returns `ApiErrorException` with HTTP 401 or "Unauthorized" message. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no leading/trailing spaces. Restart the Laravel server after updating the `.env` file. If the key was recently regenerated, update your environment and clear the config cache with `php artisan config:clear`. |
| Call not being answered | Inbound calls arrive but the voicemail system does not answer or record. | Confirm that the `call.answered` webhook event is being received. Check that your `TELNYX_CONNECTION_ID` is correctly set in the `.env` file and matches the Call Control Application ID in the Telnyx Portal. Verify that the Call Control Application is linked to your Telnyx phone number. Review Laravel logs for any exceptions in the `answerAndRecord()` method. |
| Database migration fails | Running `php artisan migrate` returns an error about the `voicemails` table. | Ensure your database is properly configured in `.env` (check `DB_CONNECTION`, `DB_HOST`, `DB_DATABASE`, etc.). If using SQLite, verify the `database/database.sqlite` file exists and is writable. Run `php artisan migrate:fresh` to reset migrations if needed. Check that no other migration has a conflicting table name. |

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

- [Handle Inbound Calls with PHP and Laravel](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/inbound-call-webhook).
- [Record Phone Calls with PHP and Laravel](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/call-recording).
- [Transfer Calls with PHP and Laravel](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/call-transfer).
