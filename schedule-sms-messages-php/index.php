<?php
// app/Http/Controllers/SmsController.php
namespace App\Http\Controllers;

use App\Jobs\SendScheduledSms;
use App\Models\ScheduledMessage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class SmsController extends Controller
{
    public function scheduleMessage(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'to' => 'required|string|regex:/^\+\d{1,15}$/',
            'message' => 'required|string|max:1600',
            'scheduled_at' => 'required|date_format:Y-m-d H:i:s|after:now',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'error' => 'Validation failed',
                'details' => $validator->errors(),
            ], 400);
        }

        try {
            $scheduledMessage = ScheduledMessage::create([
                'to_number' => $request->input('to'),
                'message' => $request->input('message'),
                'scheduled_at' => $request->input('scheduled_at'),
                'status' => 'pending',
            ]);

            SendScheduledSms::dispatch($scheduledMessage)
                ->delay($scheduledMessage->scheduled_at);

            return response()->json([
                'id' => $scheduledMessage->id,
                'to' => $scheduledMessage->to_number,
                'message' => $scheduledMessage->message,
                'scheduled_at' => $scheduledMessage->scheduled_at->toIso8601String(),
                'status' => $scheduledMessage->status,
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Failed to schedule message',
                'details' => $e->getMessage(),
            ], 500);
        }
    }

    public function getScheduledMessage(int $id): JsonResponse
    {
        $scheduledMessage = ScheduledMessage::find($id);

        if (!$scheduledMessage) {
            return response()->json([
                'error' => 'Scheduled message not found',
            ], 404);
        }

        return response()->json([
            'id' => $scheduledMessage->id,
            'to' => $scheduledMessage->to_number,
            'message' => $scheduledMessage->message,
            'scheduled_at' => $scheduledMessage->scheduled_at->toIso8601String(),
            'status' => $scheduledMessage->status,
            'message_id' => $scheduledMessage->message_id,
            'error_message' => $scheduledMessage->error_message,
        ]);
    }

    public function listScheduledMessages(): JsonResponse
    {
        $messages = ScheduledMessage::orderBy('scheduled_at', 'desc')->get();

        return response()->json(
            $messages->map(fn($m) => [
                'id' => $m->id,
                'to' => $m->to_number,
                'message' => $m->message,
                'scheduled_at' => $m->scheduled_at->toIso8601String(),
                'status' => $m->status,
                'message_id' => $m->message_id,
            ])->toArray()
        );
    }
}

// app/Jobs/SendScheduledSms.php
namespace App\Jobs;

use App\Models\ScheduledMessage;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Telnyx\Client;

class SendScheduledSms implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public ScheduledMessage $scheduledMessage
    ) {}

    public function handle(): void
    {
        $client = new Client(apiKey: getenv('TELNYX_API_KEY'));
        $fromNumber = getenv('TELNYX_PHONE_NUMBER');

        if (!$fromNumber) {
            throw new \RuntimeException('TELNYX_PHONE_NUMBER environment variable not set');
        }

        try {
            $response = $client->messages->send([
                'from_' => $fromNumber,
                'to' => $this->scheduledMessage->to_number,
                'text' => $this->scheduledMessage->message,
            ]);

            $this->scheduledMessage->update([
                'status' => 'sent',
                'message_id' => $response->data->id,
            ]);
        } catch (\Telnyx\Exception\AuthenticationException $e) {
            $this->handleError('Authentication failed: ' . $e->getMessage());
        } catch (\Telnyx\Exception\RateLimitException $e) {
            $this->release(delay: 60);
        } catch (\Telnyx\Exception\ApiException $e) {
            $this->handleError('API error: ' . $e->getMessage());
        } catch (\Exception $e) {
            $this->handleError('Unexpected error: ' . $e->getMessage());
        }
    }

    private function handleError(string $errorMessage): void
    {
        $this->scheduledMessage->update([
            'status' => 'failed',
            'error_message' => $errorMessage,
        ]);
    }
}

// app/Models/ScheduledMessage.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ScheduledMessage extends Model
{
    protected $fillable = [
        'to_number',
        'message',
        'scheduled_at',
        'status',
        'message_id',
        'error_message',
    ];

    protected $casts = [
        'scheduled_at' => 'datetime',
    ];
}

// routes/api.php
use App\Http\Controllers\SmsController;
use Illuminate\Support\Facades\Route;

Route::post('/sms/schedule', [SmsController::class, 'scheduleMessage']);
Route::get('/sms/scheduled/{id}', [SmsController::class, 'getScheduledMessage']);
Route::get('/sms/scheduled', [SmsController::class, 'listScheduledMessages']);
