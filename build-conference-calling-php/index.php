<?php
// routes/api.php
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\ConferenceCallController;
use App\Http\Controllers\WebhookController;

Route::post('/conferences', [ConferenceCallController::class, 'initiate']);
Route::get('/conferences/{conferenceId}', [ConferenceCallController::class, 'status']);
Route::post('/conferences/{conferenceId}/end', [ConferenceCallController::class, 'end']);
Route::post('/webhooks/voice', [WebhookController::class, 'handleVoiceEvent']);

// app/Http/Controllers/ConferenceCallController.php
namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Telnyx\Client;
use Telnyx\Exception\ApiErrorException;
use App\Models\ConferenceCall;

class ConferenceCallController extends Controller
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client(apiKey: config('telnyx.api_key'));
    }

    public function initiate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'participants' => 'required|array|min:2',
            'participants.*' => 'required|string|regex:/^\+\d{10,15}$/',
        ]);

        $conferenceId = 'conf_' . uniqid();
        $initiatorNumber = config('telnyx.phone_number');

        $conference = ConferenceCall::create([
            'conference_id' => $conferenceId,
            'initiator_number' => $initiatorNumber,
            'participants' => json_encode($validated['participants']),
            'status' => 'pending',
        ]);

        $callIds = [];
        foreach ($validated['participants'] as $participantNumber) {
            try {
                $response = $this->client->calls->dial(
                    from_: $initiatorNumber,
                    to: $participantNumber,
                    connection_id: config('telnyx.connection_id'),
                    custom_headers: [
                        'X-Conference-ID' => $conferenceId,
                    ],
                );

                $callIds[] = [
                    'participant' => $participantNumber,
                    'call_control_id' => $response->data->call_control_id,
                ];
            } catch (ApiErrorException $e) {
                return response()->json([
                    'error' => 'Failed to initiate call to ' . $participantNumber,
                    'details' => $e->getMessage(),
                ], 400);
            }
        }

        return response()->json([
            'conference_id' => $conferenceId,
            'status' => 'initiated',
            'calls' => $callIds,
        ], 201);
    }

    public function status(string $conferenceId): JsonResponse
    {
        $conference = ConferenceCall::where('conference_id', $conferenceId)->first();

        if (!$conference) {
            return response()->json(['error' => 'Conference not found'], 404);
        }

        return response()->json([
            'conference_id' => $conference->conference_id,
            'status' => $conference->status,
            'participants' => json_decode($conference->participants, true),
            'started_at' => $conference->started_at,
            'ended_at' => $conference->ended_at,
        ]);
    }

    public function end(string $conferenceId): JsonResponse
    {
        $conference = ConferenceCall::where('conference_id', $conferenceId)->first();

        if (!$conference) {
            return response()->json(['error' => 'Conference not found'], 404);
        }

        $conference->update([
            'status' => 'ended',
            'ended_at' => now(),
        ]);

        return response()->json([
            'conference_id' => $conferenceId,
            'status' => 'ended',
        ]);
    }
}

// app/Http/Controllers/WebhookController.php
namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use App\Models\ConferenceCall;
use Illuminate\Support\Facades\Log;

class WebhookController extends Controller
{
    public function handleVoiceEvent(Request $request): Response
    {
        $event = $request->input('data.event_type');
        $callControlId = $request->input('data.payload.call_control_id');
        $conferenceId = $request->input('data.payload.custom_headers.X-Conference-ID');

        Log::info('Voice webhook received', [
            'event' => $event,
            'call_control_id' => $callControlId,
            'conference_id' => $conferenceId,
        ]);

        if (!$conferenceId) {
            return response('OK', 200);
        }

        $conference = ConferenceCall::where('conference_id', $conferenceId)->first();

        if (!$conference) {
            Log::warning('Conference not found for webhook', ['conference_id' => $conferenceId]);
            return response('OK', 200);
        }

        switch ($event) {
            case 'call.initiated':
                Log::info('Call initiated', ['call_control_id' => $callControlId]);
                break;

            case 'call.answered':
                if ($conference->status === 'pending') {
                    $conference->update([
                        'status' => 'active',
                        'started_at' => now(),
                    ]);
                }
                Log::info('Call answered', ['call_control_id' => $callControlId]);
                break;

            case 'call.hangup':
                Log::info('Call hangup', ['call_control_id' => $callControlId]);
                
                $participants = json_decode($conference->participants, true);
                if (count($participants) <= 1) {
                    $conference->update([
                        'status' => 'ended',
                        'ended_at' => now(),
                    ]);
                }
                break;

            default:
                Log::debug('Unhandled event type', ['event' => $event]);
        }

        return response('OK', 200);
    }
}

// app/Models/ConferenceCall.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ConferenceCall extends Model
{
    protected $fillable = [
        'conference_id',
        'initiator_number',
        'participants',
        'status',
        'started_at',
        'ended_at',
    ];

    protected $casts = [
        'participants' => 'array',
        'started_at' => 'datetime',
        'ended_at' => 'datetime',
    ];
}

// config/telnyx.php
return [
    'api_key' => env('TELNYX_API_KEY'),
    'phone_number' => env('TELNYX_PHONE_NUMBER'),
    'connection_id' => env('TELNYX_CONNECTION_ID'),
    'webhook_url' => env('WEBHOOK_URL'),
];
