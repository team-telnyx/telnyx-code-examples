# Send Bulk SMS with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that sends bulk SMS messages using the Telnyx PHP SDK. This tutorial demonstrates batch message processing with rate limiting, queue-based delivery for scalability, proper error handling for telecom APIs, and secure credential management via environment variables. You'll learn how to handle large recipient lists efficiently while respecting API rate limits and providing real-time delivery status tracking.

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
- A Telnyx phone number enabled for outbound SMS.
- Redis or database configured for Laravel queues (optional but recommended for production).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle bulk SMS logic. Generate a new service:

```bash
php artisan make:service TelnyxSmsService
```

Edit `app/Services/TelnyxSmsService.php`:

```php
<?php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;

class TelnyxSmsService
{
    private Client $client;
    private string $fromNumber;
    private int $rateLimitDelay;

    public function __construct()
    {
        $this->client = new Client(apiKey: config('telnyx.api_key'));
        $this->fromNumber = config('telnyx.from_number');
        $this->rateLimitDelay = config('telnyx.rate_limit_delay');

        if (!$this->fromNumber) {
            throw new \RuntimeException('TELNYX_PHONE_NUMBER environment variable not set');
        }
    }

    /**
     * Send SMS to a single recipient.
     * Returns JSON-serializable response data.
     */
    public function sendSms(string $toNumber, string $message): array
    {
        // Validate E.164 format to prevent API errors
        if (!str_starts_with($toNumber, '+')) {
            throw new \InvalidArgumentException(
                'Phone number must be in E.164 format (e.g., +15551234567)'
            );
        }

        if (strlen($message) === 0) {
            throw new \InvalidArgumentException('Message text cannot be empty');
        }

        try {
            $response = $this->client->messages->create([
                'from' => $this->fromNumber,
                'to' => $toNumber,
                'text' => $message,
            ]);

            // Extract serializable data — SDK objects are NOT JSON-serializable
            return [
                'message_id' => $response->data->id,
                'status' => $response->data->to[0]->status ?? 'unknown',
                'from' => $this->fromNumber,
                'to' => $toNumber,
                'segments' => $this->calculateSegments($message),
            ];
        } catch (AuthenticationException $e) {
            throw new \RuntimeException('Invalid Telnyx API key: ' . $e->getMessage());
        } catch (RateLimitException $e) {
            throw new \RuntimeException('Rate limit exceeded. Please retry after delay.');
        } catch (ApiException $e) {
            throw new \RuntimeException('Telnyx API error: ' . $e->getMessage());
        }
    }

    /**
     * Send bulk SMS to multiple recipients with rate limiting.
     * Returns array of results with success/failure tracking.
     */
    public function sendBulkSms(array $recipients, string $message): array
    {
        if (empty($recipients)) {
            throw new \InvalidArgumentException('Recipients list cannot be empty');
        }

        $results = [
            'successful' => [],
            'failed' => [],
            'total' => count($recipients),
        ];

        foreach ($recipients as $index => $toNumber) {
            try {
                $result = $this->sendSms($toNumber, $message);
                $results['successful'][] = $result;
            } catch (\Exception $e) {
                $results['failed'][] = [
                    'to' => $toNumber,
                    'error' => $e->getMessage(),
                    'index' => $index,
                ];
            }

            // Apply rate limiting between requests (except on last iteration)
            if ($index < count($recipients) - 1) {
                usleep($this->rateLimitDelay * 1000);
            }
        }

        return $results;
    }

    /**
     * Calculate SMS segment count (160 chars per segment, 153 for multi-part).
     */
    private function calculateSegments(string $message): int
    {
        $length = strlen($message);
        if ($length <= 160) {
            return 1;
        }
        // Multi-part messages use 153 chars per segment due to UDH header
        return (int) ceil($length / 153);
    }
}
```

Create a job for asynchronous bulk SMS processing. Generate a new job:

```bash
php artisan make:job SendBulkSmsJob
```

Edit `app/Jobs/SendBulkSmsJob.php`:

```php
<?php

namespace App\Jobs;

use App\Services\TelnyxSmsService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class SendBulkSmsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        private array $recipients,
        private string $message,
        private ?string $batchId = null,
    ) {}

    public function handle(TelnyxSmsService $smsService): void
    {
        try {
            $results = $smsService->sendBulkSms($this->recipients, $this->message);

            Log::info('Bulk SMS job completed', [
                'batch_id' => $this->batchId,
                'successful' => count($results['successful']),
                'failed' => count($results['failed']),
                'total' => $results['total'],
            ]);
        } catch (\Exception $e) {
            Log::error('Bulk SMS job failed', [
                'batch_id' => $this->batchId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }
}
```

Create a controller to handle HTTP requests. Generate a new controller:

```bash
php artisan make:controller SmsController
```

Edit `app/Http/Controllers/SmsController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Jobs\SendBulkSmsJob;
use App\Services\TelnyxSmsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;

class SmsController extends Controller
{
    public function __construct(private TelnyxSmsService $smsService) {}

    /**
     * Send SMS to a single recipient.
     */
    public function sendSingle(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'to' => 'required|string|regex:/^\+\d{1,15}$/',
            'message' => 'required|string|max:1600',
        ]);

        try {
            $result = $this->smsService->sendSms($validated['to'], $validated['message']);
            return response()->json($result, 200);
        } catch (AuthenticationException $e) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (RateLimitException $e) {
            return response()->json(['error' => 'Rate limit exceeded. Please slow down.'], 429);
        } catch (ApiException $e) {
            return response()->json(['error' => $e->getMessage()], $e->getHttpStatus() ?? 400);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Send bulk SMS synchronously (for small batches).
     */
    public function sendBulk(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'recipients' => 'required|array|min:1|max:1000',
            'recipients.*' => 'string|regex:/^\+\d{1,15}$/',
            'message' => 'required|string|max:1600',
        ]);

        try {
            $results = $this->smsService->sendBulkSms(
                $validated['recipients'],
                $validated['message']
            );

            return response()->json([
                'successful' => count($results['successful']),
                'failed' => count($results['failed']),
                'total' => $results['total'],
                'details' => $results,
            ], 200);
        } catch (AuthenticationException $e) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (RateLimitException $e) {
            return response()->json(['error' => 'Rate limit exceeded. Please slow down.'], 429);
        } catch (ApiException $e) {
            return response()->json(['error' => $e->getMessage()], $e->getHttpStatus() ?? 400);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Queue bulk SMS for asynchronous processing.
     */
    public function queueBulk(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'recipients' => 'required|array|min:1|max:10000',
            'recipients.*' => 'string|regex:/^\+\d{1,15}$/',
            'message' => 'required|string|max:1600',
        ]);

        try {
            $batchId = uniqid('batch_', true);

            SendBulkSmsJob::dispatch(
                $validated['recipients'],
                $validated['message'],
                $batchId
            );

            return response()->json([
                'batch_id' => $batchId,
                'status' => 'queued',
                'recipient_count' => count($validated['recipients']),
                'message' => 'Bulk SMS job has been queued for processing.',
            ], 202);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\SmsController;
use Illuminate\Support\Facades\Route;

Route::post('/sms/send', [SmsController::class, 'sendSingle']);
Route::post('/sms/bulk', [SmsController::class, 'sendBulk']);
Route::post('/sms/bulk/queue', [SmsController::class, 'queueBulk']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Laravel server with `php artisan serve`. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. Validate the regex pattern in the controller matches your input. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429 after sending multiple messages rapidly. | Increase the `RATE_LIMIT_DELAY` value in your `.env` file (in milliseconds). For example, change `RATE_LIMIT_DELAY=100` to `RATE_LIMIT_DELAY=500` to add 500ms between API calls. For large batches, use the `/api/sms/bulk/queue` endpoint to process messages asynchronously via the queue worker instead of synchronously. |
| Queue Jobs Not Processing | Bulk SMS jobs are queued but not being executed; batch status remains "queued" indefinitely. | Ensure the queue worker is running with `php artisan queue:work`. For production, configure a persistent queue driver (Redis or database) in `config/queue.php` instead of the default `sync` driver. Check Laravel logs in `storage/logs/` for job execution errors. |
| Environment Variable Not Set | The application raises `RuntimeException: TELNYX_PHONE_NUMBER environment variable not set` on startup or first request. | Confirm your `.env` file exists in the project root and contains both `TELNYX_API_KEY` and `TELNYX_PHONE_NUMBER`. Run `php artisan config:cache` to refresh cached configuration. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). Restart the Laravel server after updating the `.env` file. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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

- [Receive SMS Webhooks with PHP](/tutorials/sms/php/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/php/otp-2fa).
- [Build Two-Way SMS Conversations](/tutorials/sms/php/two-way-sms).
