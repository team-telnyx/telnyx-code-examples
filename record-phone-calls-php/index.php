<?php
// config/telnyx.php
return [
    'api_key' => env('TELNYX_API_KEY'),
    'phone_number' => env('TELNYX_PHONE_NUMBER'),
    'connection_id' => env('TELNYX_CONNECTION_ID'),
    'webhook_url' => env('WEBHOOK_URL'),
];

// app/Services/CallRecordingService.php
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
        $this->client = new Client(apiKey: getenv('TELNYX_API_KEY'));
        $this->phoneNumber = getenv('TELNYX_PHONE_NUMBER');
        $this->connectionId = getenv('TELNYX_CONNECTION_ID');

        if (!$this->phoneNumber || !$this->connectionId) {
            throw new \RuntimeException('Missing required Telnyx configuration');
        }
    }

    public function initiateCallWithRecording(string $toNumber): array
    {
        if (!preg_match('/^\+\d{1,15}$/', $toNumber)) {
            throw new \InvalidArgumentException(
                'Phone number must be in E.164 format (e.g., +15551234567)'
            );
        }

        try {
            $response = $this->client->calls->dial(
                from_: $this->phoneNumber,
                to: $toNumber,
                connection_id: $this->connectionId,
            );

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

    public function startRecording(string $callControlId, string $format = 'wav'): array
    {
        if (!$callControlId) {
            throw new \InvalidArgumentException('call_control_id is required');
        }

        try {
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

    public function stopRecording(string $callControlId): array
    {
        if (!$callControlId) {
            throw new \InvalidArgumentException('call_control_id is required');
        }

        try {
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

    public function hangupCall(string $callControlId): array
    {
        if (!$callControlId) {
            throw new \InvalidArgumentException('call_control_id is required');
        }

        try {
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

// app/Http/Controllers/CallRecordingController.php
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

    public function handleWebhook(Request $request): JsonResponse
    {
        $payload = $request->all();
        $eventType = $payload['data']['event_type'] ?? null;
        $callControlId = $payload['data']['call_control_id'] ?? null;

        \Log::info('Telnyx webhook received', [
            'event_type' => $eventType,
            'call_control_id' => $callControlId,
        ]);

        switch ($eventType) {
            case 'call.initiated':
                \Log::info('Call initiated', ['call_control_id' => $callControlId]);
                break;

            case 'call.answered':
                \Log::info('Call answered', ['call_control_id' => $callControlId]);
                break;

            case 'call.recording.saved':
                $recordingUrl = $payload['data']['recording_urls']['wav'] ?? null;
                \Log::info('Recording saved', [
                    'call_control_id' => $callControlId,
                    'recording_url' => $recordingUrl,
                ]);
                break;

            case 'call.hangup':
                \Log::info('Call ended', ['call_control_id' => $callControlId]);
                break;

            default:
                \Log::debug('Unhandled webhook event', ['event_type' => $eventType]);
        }

        return response()->json(['status' => 'received'], 200);
    }
}

// routes/api.php
use App\Http\Controllers\CallRecordingController;
use Illuminate\Support\Facades\Route;

Route::post('/calls/initiate', [CallRecordingController::class, 'initiateCall']);
Route::post('/calls/recording/start', [CallRecordingController::class, 'startRecording']);
Route::post('/calls/recording/stop', [CallRecordingController::class, 'stopRecording']);
Route::post('/calls/hangup', [CallRecordingController::class, 'hangupCall']);
Route::post('/webhooks/call', [CallRecordingController::class, 'handleWebhook']);
