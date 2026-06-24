# SMS Survey with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that sends SMS survey questions and collects responses via inbound SMS webhooks. This tutorial demonstrates the Telnyx PHP SDK with Laravel's routing, middleware, and database patterns. You'll learn to send survey questions, receive responses, store results, and handle webhook validation for production resilience.

## Who Is This For?

- **PHP developers** building sms features with Laravel.
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
- A Telnyx phone number enabled for inbound and outbound SMS.
- A publicly accessible URL for webhook delivery (ngrok or similar for local development).
- SQLite or MySQL database configured in your Laravel `.env`.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-survey-bot-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a model for survey responses. Run:

```bash
php artisan make:model SurveyResponse
```

Edit `app/Models/SurveyResponse.php`:

```php
<?php

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
```

Create a controller to handle survey logic. Run:

```bash
php artisan make:controller SurveyController
```

Edit `app/Http/Controllers/SurveyController.php`:

```php
<?php

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

    /**
     * Start a survey by sending the first question to a phone number.
     */
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

    /**
     * Handle inbound SMS webhook from Telnyx.
     */
    public function handleWebhook(Request $request): JsonResponse
    {
        // Validate webhook signature (optional but recommended for production).
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
            // Find the last survey response for this phone number to determine next question.
            $lastResponse = SurveyResponse::where('phone_number', $phoneNumber)
                ->orderBy('question_number', 'desc')
                ->first();

            $currentQuestionNumber = $lastResponse ? $lastResponse->question_number : 0;
            $nextQuestionNumber = $currentQuestionNumber + 1;

            // Store the response.
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

            // Send next question or completion message.
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

    /**
     * Retrieve survey results for a phone number.
     */
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

    /**
     * Handle Telnyx SDK exceptions and map to HTTP status codes.
     */
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
```

Register routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\SurveyController;
use Illuminate\Support\Facades\Route;

Route::post('/survey/start', [SurveyController::class, 'startSurvey']);
Route::post('/webhooks/sms', [SurveyController::class, 'handleWebhook']);
Route::get('/survey/results', [SurveyController::class, 'getSurveyResults']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-survey-bot-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Laravel development server with `php artisan serve` after updating `.env`. |
| Webhook Not Receiving Messages | Inbound SMS messages are not triggering the webhook endpoint. | Confirm your Telnyx Messaging Profile webhook URL is set to your public endpoint (e.g., `https://your-ngrok-url.ngrok.io/api/webhooks/sms`). Verify the URL is publicly accessible by testing with curl. Check Laravel logs with `tail -f storage/logs/laravel.log` for processing errors. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or validation fails. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Database Migration Fails | Running `php artisan migrate` returns an error about the migration file. | Verify the migration file exists in `database/migrations/` and the class name matches the filename. Ensure your database connection is configured correctly in `.env` (check `DB_CONNECTION`, `DB_HOST`, `DB_DATABASE`). Run `php artisan migrate:refresh` to reset and re-run all migrations. |
| Webhook Payload Parsing Error | The webhook handler returns `{"error": "Invalid webhook payload"}`. | Verify the Telnyx webhook payload structure matches your code expectations. Log the raw payload with `\Log::info(json_encode($request->all()))` to inspect the actual structure. Update your code to match the payload format returned by Telnyx. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What PHP version do I need?**

PHP 8.1 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Receive SMS Webhooks with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/receive-sms-webhook).
- [Send Bulk SMS Messages with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/otp-2fa).
