<?php
// routes/api.php
use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::post('/webhooks/call', [WebhookController::class, 'handleCall']);
Route::get('/call-history', [WebhookController::class, 'getHistory']);

// app/Http/Controllers/WebhookController.php
namespace App\Http\Controllers;

use App\Services\CallForwardingService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

class WebhookController extends Controller
{
    private CallForwardingService $callForwardingService;

    public function __construct(CallForwardingService $callForwardingService)
    {
        $this->callForwardingService = $callForwardingService;
    }

    public function handleCall(Request $request): JsonResponse
    {
        $payload = $request->all();
        $eventType = $payload['data']['event_type'] ?? null;
        $callControlId = $payload['data']['call_control_id'] ?? null;

        Log::info("Webhook received", [
            'event_type' => $eventType,
            'call_control_id' => $callControlId,
        ]);

        if (!$callControlId) {
            return response()->json(['error' => 'Missing call_control_id'], 400);
        }

        try {
            switch ($eventType) {
                case 'call.initiated':
                    $fromNumber = $payload['data']['from']['phone_number'] ?? 'unknown';
                    $result = $this->callForwardingService->answerAndForward(
                        $callControlId,
                        $fromNumber
                    );
                    return response()->json($result);

                case 'call.answered':
                    $result = $this->callForwardingService->transferCall($callControlId);
                    return response()->json($result);

                case 'call.hangup':
                    $result = $this->callForwardingService->hangupCall($callControlId);
                    return response()->json($result);

                default:
                    Log::info("Unhandled event type", ['event_type' => $eventType]);
                    return response()->json(['status' => 'acknowledged'], 200);
            }
        } catch (\Exception $e) {
            Log::error("Webhook processing error", [
                'error' => $e->getMessage(),
                'call_control_id' => $callControlId,
            ]);

            return response()->json([
                'error' => 'Internal server error',
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    public function getHistory(): JsonResponse
    {
        try {
            $history = $this->callForwardingService->getCallHistory();
            return response()->json(['calls' => $history], 200);
        } catch (\Exception $e) {
            Log::error("Failed to retrieve call history", ['error' => $e->getMessage()]);
            return response()->json(['error' => 'Failed to retrieve history'], 500);
        }
    }
}

// app/Services/CallForwardingService.php
namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;
use App\Models\CallForward;
use Illuminate\Support\Facades\Log;

class CallForwardingService
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client(apiKey: config('services.telnyx.api_key'));
    }

    public function answerAndForward(string $callControlId, string $fromNumber): array
    {
        try {
            $this->client->calls->actions->answer($callControlId);

            CallForward::create([
                'call_control_id' => $callControlId,
                'from_number' => $fromNumber,
                'to_number' => config('services.telnyx.forward_to'),
                'status' => 'answered',
            ]);

            Log::info("Call answered and logged", ['call_control_id' => $callControlId]);

            return [
                'success' => true,
                'call_control_id' => $callControlId,
                'status' => 'answered',
            ];
        } catch (ApiException $e) {
            Log::error("Failed to answer call", [
                'call_control_id' => $callControlId,
                'error' => $e->getMessage(),
            ]);

            return [
                'success' => false,
                'error' => $e->getMessage(),
            ];
        }
    }

    public function transferCall(string $callControlId): array
    {
        try {
            $forwardTo = config('services.telnyx.forward_to');

            $this->client->calls->actions->transfer(
                $callControlId,
                to: $forwardTo
            );

            CallForward::where('call_control_id', $callControlId)
                ->update(['status' => 'transferred']);

            Log::info("Call transferred", [
                'call_control_id' => $callControlId,
                'to' => $forwardTo,
            ]);

            return [
                'success' => true,
                'call_control_id' => $callControlId,
                'transferred_to' => $forwardTo,
            ];
        } catch (ApiException $e) {
            Log::error("Failed to transfer call", [
                'call_control_id' => $callControlId,
                'error' => $e->getMessage(),
            ]);

            return [
                'success' => false,
                'error' => $e->getMessage(),
            ];
        }
    }

    public function hangupCall(string $callControlId): array
    {
        try {
            $this->client->calls->actions->hangup($callControlId);

            CallForward::where('call_control_id', $callControlId)
                ->update(['status' => 'completed']);

            Log::info("Call hung up", ['call_control_id' => $callControlId]);

            return [
                'success' => true,
                'call_control_id' => $callControlId,
                'status' => 'completed',
            ];
        } catch (ApiException $e) {
            Log::error("Failed to hangup call", [
                'call_control_id' => $callControlId,
                'error' => $e->getMessage(),
            ]);

            return [
                'success' => false,
                'error' => $e->getMessage(),
            ];
        }
    }

    public function getCallHistory(int $limit = 50): array
    {
        $calls = CallForward::latest()->limit($limit)->get();

        return array_map(fn($call) => [
            'id' => $call->id,
            'call_control_id' => $call->call_control_id,
            'from_number' => $call->from_number,
            'to_number' => $call->to_number,
            'status' => $call->status,
            'created_at' => $call->created_at->toIso8601String(),
        ], $calls->toArray());
    }
}

// app/Models/CallForward.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CallForward extends Model
{
    protected $fillable = [
        'call_control_id',
        'from_number',
        'to_number',
        'status',
    ];

    public $timestamps = true;
}

// config/services.php (add to existing array)
'telnyx' => [
    'api_key' => env('TELNYX_API_KEY'),
    'phone_number' => env('TELNYX_PHONE_NUMBER'),
    'connection_id' => env('TELNYX_CONNECTION_ID'),
    'forward_to' => env('FORWARD_TO_NUMBER'),
],

// .env
TELNYX_API_KEY=YOUR_API_KEY_HERE
TELNYX_PHONE_NUMBER=+15551234567
TELNYX_CONNECTION_ID=YOUR_CONNECTION_ID_HERE
FORWARD_TO_NUMBER=+15559876543
WEBHOOK_URL=https://your-domain.com/api/webhooks/call
