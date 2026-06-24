<?php
// app/Services/TelnyxSmsService.php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;

class TelnyxSmsService
{
    private Client $client;
    private string $fromNumber;

    public function __construct()
    {
        $this->client = new Client(apiKey: getenv('TELNYX_API_KEY'));
        $this->fromNumber = getenv('TELNYX_PHONE_NUMBER');
    }

    public function sendMessage(string $toNumber, string $message): array
    {
        if (!$this->fromNumber) {
            throw new \Exception('TELNYX_PHONE_NUMBER environment variable not set');
        }

        if (!str_starts_with($toNumber, '+')) {
            throw new \Exception('Phone number must be in E.164 format (e.g., +15551234567)');
        }

        try {
            $response = $this->client->messages->create([
                'from_' => $this->fromNumber,
                'to' => $toNumber,
                'text' => $message,
            ]);

            return [
                'message_id' => $response->data->id,
                'status' => $response->data->to[0]->status ?? 'pending',
                'from' => $this->fromNumber,
                'to' => $toNumber,
            ];
        } catch (AuthenticationException $e) {
            throw new \Exception('Invalid API key: ' . $e->getMessage());
        } catch (RateLimitException $e) {
            throw new \Exception('Rate limit exceeded. Please slow down.');
        } catch (ApiException $e) {
            throw new \Exception('Telnyx API error: ' . $e->getMessage());
        }
    }

    public function getMessageDetails(string $messageId): array
    {
        try {
            $response = $this->client->messages->retrieve($messageId);

            return [
                'id' => $response->data->id,
                'from' => $response->data->from,
                'to' => $response->data->to[0]->phone_number ?? null,
                'text' => $response->data->text,
                'direction' => $response->data->direction,
                'status' => $response->data->to[0]->status ?? 'unknown',
            ];
        } catch (AuthenticationException $e) {
            throw new \Exception('Invalid API key: ' . $e->getMessage());
        } catch (ApiException $e) {
            throw new \Exception('Telnyx API error: ' . $e->getMessage());
        }
    }
}

// app/Http/Controllers/SmsController.php

namespace App\Http\Controllers;

use App\Models\SmsMessage;
use App\Services\TelnyxSmsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SmsController extends Controller
{
    private TelnyxSmsService $smsService;

    public function __construct(TelnyxSmsService $smsService)
    {
        $this->smsService = $smsService;
    }

    public function send(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'to' => 'required|string',
            'message' => 'required|string|max:1600',
        ]);

        try {
            $result = $this->smsService->sendMessage(
                $validated['to'],
                $validated['message']
            );

            SmsMessage::create([
                'message_id' => $result['message_id'],
                'from' => $result['from'],
                'to' => $result['to'],
                'text' => $validated['message'],
                'direction' => 'outbound',
                'status' => $result['status'],
            ]);

            return response()->json($result, 200);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        }
    }

    public function conversation(Request $request): JsonResponse
    {
        $phoneNumber = $request->query('phone');

        if (!$phoneNumber) {
            return response()->json(['error' => 'Phone number required'], 400);
        }

        $messages = SmsMessage::where('from', $phoneNumber)
            ->orWhere('to', $phoneNumber)
            ->orderBy('created_at', 'asc')
            ->get();

        return response()->json(
            $messages->map(fn($msg) => [
                'id' => $msg->id,
                'message_id' => $msg->message_id,
                'from' => $msg->from,
                'to' => $msg->to,
                'text' => $msg->text,
                'direction' => $msg->direction,
                'status' => $msg->status,
                'created_at' => $msg->created_at->toIso8601String(),
            ])->toArray(),
            200
        );
    }
}

// app/Http/Controllers/WebhookController.php

namespace App\Http\Controllers;

use App\Models\SmsMessage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class WebhookController extends Controller
{
    public function handleSmsWebhook(Request $request): JsonResponse
    {
        Log::info('SMS Webhook received', $request->all());

        $data = $request->all();
        $eventType = $data['data']['event_type'] ?? null;

        if ($eventType === 'message.received') {
            $messageData = $data['data'];

            SmsMessage::create([
                'message_id' => $messageData['id'],
                'from' => $messageData['from']['phone_number'],
                'to' => $messageData['to'][0]['phone_number'] ?? null,
                'text' => $messageData['text'],
                'direction' => 'inbound',
                'status' => 'received',
            ]);

            Log::info('Inbound SMS stored', [
                'message_id' => $messageData['id'],
                'from' => $messageData['from']['phone_number'],
            ]);

            return response()->json(['status' => 'received'], 200);
        }

        if ($eventType === 'message.finalized') {
            $messageData = $data['data'];
            $status = $messageData['to'][0]['status'] ?? 'unknown';

            SmsMessage::where('message_id', $messageData['id'])
                ->update(['status' => $status]);

            Log::info('Message status updated', [
                'message_id' => $messageData['id'],
                'status' => $status,
            ]);

            return response()->json(['status' => 'updated'], 200);
        }

        return response()->json(['status' => 'ignored'], 200);
    }
}

// routes/api.php

use App\Http\Controllers\SmsController;
use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::post('/sms/send', [SmsController::class, 'send']);
Route::get('/sms/conversation', [SmsController::class, 'conversation']);
Route::post('/webhooks/sms', [WebhookController::class, 'handleSmsWebhook']);

// .env

TELNYX_API_KEY=YOUR_API_KEY_HERE
TELNYX_PHONE_NUMBER=+15551234567
WEBHOOK_URL=https://your-domain.com/webhooks/sms
