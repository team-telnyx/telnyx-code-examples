<?php
// app/Services/TelnyxSmsService.php
namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;

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
            $response = $this->client->messages->send([
                'from_' => $this->fromNumber,
                'to' => $toNumber,
                'text' => $message,
            ]);

            return [
                'message_id' => $response->data->id,
                'status' => $response->data->to[0]->status ?? 'unknown',
                'from' => $this->fromNumber,
                'to' => $toNumber,
            ];
        } catch (ApiException $e) {
            throw new \Exception('Telnyx API error: ' . $e->getMessage());
        }
    }
}

// app/Models/SurveyResponse.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SurveyResponse extends Model
{
    protected $fillable = [
        'phone_number',
        'question_number',
        'question_text',
        'response_text',
        'message_id',
    ];
}

// app/Http/Controllers/SurveyController.php
namespace App\Http\Controllers;

use App\Models\SurveyResponse;
use App\Services\TelnyxSmsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Exception\ApiException;

class SurveyController extends Controller
{
    private TelnyxSmsService $smsService;

    public function __construct(TelnyxSmsService $smsService)
    {
        $this->smsService = $smsService;
    }

    public function startSurvey(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'phone_number' => 'required|string|regex:/^\+\d{10,15}$/',
        ]);

        $phoneNumber = $validated['phone_number'];
        $questions = [
            1 => 'How satisfied are you with our service? Reply: 1 (Very Unsatisfied) to 5 (Very Satisfied)',
            2 => 'Would you recommend us to a friend? Reply: Yes or No',
            3 => 'What could we improve? Reply with your feedback',
        ];

        try {
            $result = $this->smsService->sendMessage(
                $phoneNumber,
                $questions[1]
            );

            return response()->json([
                'success' => true,
                'message' => 'Survey started',
                'message_id' => $result['message_id'],
                'question_number' => 1,
            ], 200);
        } catch (\Exception $e) {
            return $this->handleSmsException($e);
        }
    }

    public function handleWebhook(Request $request): JsonResponse
    {
        $payload = $request->all();

        if (!isset($payload['data']['payload']['text'])) {
            return response()->json(['error' => 'Invalid webhook payload'], 400);
        }

        $webhookData = $payload['data']['payload'];
        $phoneNumber = $webhookData['from']['phone_number'] ?? null;
        $messageText = $webhookData['text'] ?? '';
        $messageId = $webhookData['id'] ?? null;

        if (!$phoneNumber || !$messageId) {
            return response()->json(['error' => 'Missing required fields'], 400);
        }

        try {
            $lastResponse = SurveyResponse::where('phone_number', $phoneNumber)
                ->orderBy('question_number', 'desc')
                ->first();

            $currentQuestionNumber = $lastResponse ? $lastResponse->question_number : 0;
            $nextQuestionNumber = $currentQuestionNumber + 1;

            if ($currentQuestionNumber > 0) {
                $questions = [
                    1 => 'How satisfied are you with our service? Reply: 1 (Very Unsatisfied) to 5 (Very Satisfied)',
                    2 => 'Would you recommend us to a friend? Reply: Yes or No',
                    3 => 'What could we improve? Reply with your feedback',
                ];

                SurveyResponse::create([
                    'phone_number' => $phoneNumber,
                    'question_number' => $currentQuestionNumber,
                    'question_text' => $questions[$currentQuestionNumber] ?? 'Unknown',
                    'response_text' => $messageText,
                    'message_id' => $messageId,
                ]);
            }

            $questions = [
                1 => 'How satisfied are you with our service? Reply: 1 (Very Unsatisfied) to 5 (Very Satisfied)',
                2 => 'Would you recommend us to a friend? Reply: Yes or No',
                3 => 'What could we improve? Reply with your feedback',
            ];

            if ($nextQuestionNumber <= 3) {
                $this->smsService->sendMessage($phoneNumber, $questions[$nextQuestionNumber]);
            } else {
                $this->smsService->sendMessage(
                    $phoneNumber,
                    'Thank you for completing our survey! Your feedback is valuable.'
                );
            }

            return response()->json(['success' => true], 200);
        } catch (\Exception $e) {
            \Log::error('Webhook processing error: ' . $e->getMessage());
            return response()->json(['error' => 'Processing failed'], 500);
        }
    }

    public function getSurveyResults(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'phone_number' => 'required|string|regex:/^\+\d{10,15}$/',
        ]);

        $responses = SurveyResponse::where('phone_number', $validated['phone_number'])
            ->orderBy('question_number', 'asc')
            ->get();

        return response()->json([
            'phone_number' => $validated['phone_number'],
            'responses' => $responses->map(fn($r) => [
                'question_number' => $r->question_number,
                'question_text' => $r->question_text,
                'response_text' => $r->response_text,
                'created_at' => $r->created_at,
            ])->toArray(),
        ], 200);
    }

    private function handleSmsException(\Exception $e): JsonResponse
    {
        if ($e instanceof \Telnyx\Exception\AuthenticationException) {
            return response()->json(['error' => 'Invalid API key'], 401);
        }

        if ($e instanceof \Telnyx\Exception\RateLimitException) {
            return response()->json(['error' => 'Rate limit exceeded'], 429);
        }

        if ($e instanceof \Telnyx\Exception\ApiException) {
            return response()->json([
                'error' => $e->getMessage(),
                'status_code' => $e->getHttpStatus(),
            ], $e->getHttpStatus() ?? 500);
        }

        return response()->json(['error' => $e->getMessage()], 500);
    }
}

// routes/api.php
use App\Http\Controllers\SurveyController;
use Illuminate\Support\Facades\Route;

Route::post('/survey/start', [SurveyController::class, 'startSurvey']);
Route::post('/webhooks/sms', [SurveyController::class, 'handleWebhook']);
Route::get('/survey/results', [SurveyController::class, 'getSurveyResults']);

// .env
TELNYX_API_KEY=YOUR_API_KEY_HERE
TELNYX_PHONE_NUMBER=+15551234567
WEBHOOK_URL=https://your-domain.com/webhooks/sms
