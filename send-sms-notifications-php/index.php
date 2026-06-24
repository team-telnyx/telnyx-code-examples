<?php
// app/Services/TelnyxSmsService.php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;
use Illuminate\Support\Facades\Log;

class TelnyxSmsService
{
    private Client $client;
    private string $fromNumber;

    public function __construct()
    {
        $this->client = new Client(apiKey: config('services.telnyx.api_key'));
        $this->fromNumber = config('services.telnyx.phone_number');

        if (!$this->fromNumber) {
            throw new \RuntimeException('TELNYX_PHONE_NUMBER not configured');
        }
    }

    public function sendSms(string $toNumber, string $message): array
    {
        if (!str_starts_with($toNumber, '+')) {
            throw new \RuntimeException('Phone number must be in E.164 format (e.g., +15551234567)');
        }

        if (strlen($message) > 1600) {
            Log::warning('SMS message truncated', [
                'original_length' => strlen($message),
                'to' => $toNumber,
            ]);
            $message = substr($message, 0, 1600);
        }

        try {
            $response = $this->client->messages->send([
                'from_' => $this->fromNumber,
                'to' => $toNumber,
                'text' => $message,
            ]);

            return [
                'message_id' => $response->data->id,
                'status' => $response->data->to[0]->status ?? 'pending',
                'from' => $this->fromNumber,
                'to' => $toNumber,
                'segments' => $response->data->parts ?? 1,
            ];
        } catch (AuthenticationException $e) {
            Log::error('Telnyx authentication failed', ['error' => $e->getMessage()]);
            throw $e;
        } catch (RateLimitException $e) {
            Log::warning('Telnyx rate limit exceeded', ['error' => $e->getMessage()]);
            throw $e;
        } catch (ApiException $e) {
            Log::error('Telnyx API error', [
                'error' => $e->getMessage(),
                'status_code' => $e->getHttpStatus(),
            ]);
            throw $e;
        }
    }

    public function sendNotification(string $toNumber, string $type, array $data = []): array
    {
        $message = $this->buildNotificationMessage($type, $data);
        return $this->sendSms($toNumber, $message);
    }

    private function buildNotificationMessage(string $type, array $data): string
    {
        return match ($type) {
            'password_reset' => sprintf(
                'Your password reset code is: %s. Valid for 1 hour.',
                $data['code'] ?? 'N/A'
            ),
            'order_confirmation' => sprintf(
                'Order #%s confirmed. Total: $%s. Track at: %s',
                $data['order_id'] ?? 'N/A',
                $data['amount'] ?? '0.00',
                $data['tracking_url'] ?? 'example.com'
            ),
            'account_alert' => sprintf(
                'Alert: %s. If this wasn\'t you, contact support immediately.',
                $data['alert_message'] ?? 'Unusual activity detected'
            ),
            default => $data['message'] ?? 'Notification from your service',
        };
    }
}

// app/Http/Controllers/SmsNotificationController.php

namespace App\Http\Controllers;

use App\Services\TelnyxSmsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;

class SmsNotificationController extends Controller
{
    public function __construct(private TelnyxSmsService $smsService)
    {
    }

    public function send(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'to' => 'required|string|regex:/^\+\d{1,15}$/',
            'type' => 'required|string|in:password_reset,order_confirmation,account_alert,custom',
            'data' => 'nullable|array',
            'message' => 'required_if:type,custom|string|max:1600',
        ]);

        try {
            if ($validated['type'] === 'custom') {
                $result = $this->smsService->sendSms(
                    $validated['to'],
                    $validated['message']
                );
            } else {
                $result = $this->smsService->sendNotification(
                    $validated['to'],
                    $validated['type'],
                    $validated['data'] ?? []
                );
            }

            return response()->json($result, 200);
        } catch (AuthenticationException) {
            return response()->json(['error' => 'Invalid Telnyx API key'], 401);
        } catch (RateLimitException) {
            return response()->json(['error' => 'Rate limit exceeded. Please try again later.'], 429);
        } catch (ApiException $e) {
            return response()->json(
                ['error' => 'Telnyx API error: ' . $e->getMessage()],
                $e->getHttpStatus() ?? 500
            );
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        }
    }

    public function sendBulk(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'recipients' => 'required|array|min:1|max:100',
            'recipients.*' => 'string|regex:/^\+\d{1,15}$/',
            'type' => 'required|string|in:password_reset,order_confirmation,account_alert,custom',
            'data' => 'nullable|array',
            'message' => 'required_if:type,custom|string|max:1600',
        ]);

        $results = [];
        $errors = [];

        foreach ($validated['recipients'] as $recipient) {
            try {
                if ($validated['type'] === 'custom') {
                    $result = $this->smsService->sendSms(
                        $recipient,
                        $validated['message']
                    );
                } else {
                    $result = $this->smsService->sendNotification(
                        $recipient,
                        $validated['type'],
                        $validated['data'] ?? []
                    );
                }
                $results[] = array_merge($result, ['recipient' => $recipient]);
            } catch (\Exception $e) {
                $errors[] = [
                    'recipient' => $recipient,
                    'error' => $e->getMessage(),
                ];
            }
        }

        return response()->json([
            'sent' => count($results),
            'failed' => count($errors),
            'results' => $results,
            'errors' => $errors,
        ], count($errors) > 0 ? 207 : 200);
    }
}

// routes/api.php

use App\Http\Controllers\SmsNotificationController;
use Illuminate\Support\Facades\Route;

Route::post('/sms/send', [SmsNotificationController::class, 'send']);
Route::post('/sms/send-bulk', [SmsNotificationController::class, 'sendBulk']);

// config/services.php (add to existing array)

'telnyx' => [
    'api_key' => env('TELNYX_API_KEY'),
    'phone_number' => env('TELNYX_PHONE_NUMBER'),
],

// .env

TELNYX_API_KEY=YOUR_API_KEY_HERE
TELNYX_PHONE_NUMBER=+15551234567
