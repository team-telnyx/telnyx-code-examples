# Scheduled SMS with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that schedules SMS messages to be sent at specific times using the Telnyx PHP SDK. This tutorial demonstrates job queuing with Laravel's queue system, proper error handling for telecom APIs, and secure credential management via environment variables. You'll create a controller endpoint that accepts scheduling requests and uses Laravel's task scheduler to dispatch messages at the specified time.

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
- A queue driver configured (database or Redis recommended for production).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/schedule-sms-messages-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a model for scheduled messages:

```bash
php artisan make:model ScheduledMessage
```

Edit `app/Models/ScheduledMessage.php`:

```php
<?php

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
```

Create a job to handle SMS sending:

```bash
php artisan make:job SendScheduledSms
```

Edit `app/Jobs/SendScheduledSms.php`:

```php
<?php

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
            // Send the SMS via Telnyx API
            $response = $client->messages->send([
                'from_' => $fromNumber,
                'to' => $this->scheduledMessage->to_number,
                'text' => $this->scheduledMessage->message,
            ]);

            // Update the scheduled message record with success status
            $this->scheduledMessage->update([
                'status' => 'sent',
                'message_id' => $response->data->id,
            ]);
        } catch (\Telnyx\Exception\AuthenticationException $e) {
            $this->handleError('Authentication failed: ' . $e->getMessage());
        } catch (\Telnyx\Exception\RateLimitException $e) {
            // Retry on rate limit
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
```

Create a controller to handle scheduling requests:

```bash
php artisan make:controller SmsController
```

Edit `app/Http/Controllers/SmsController.php`:

```php
<?php

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
        // Validate incoming request
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
            // Create the scheduled message record
            $scheduledMessage = ScheduledMessage::create([
                'to_number' => $request->input('to'),
                'message' => $request->input('message'),
                'scheduled_at' => $request->input('scheduled_at'),
                'status' => 'pending',
            ]);

            // Dispatch the job to be executed at the scheduled time
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
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\SmsController;
use Illuminate\Support\Facades\Route;

Route::post('/sms/schedule', [SmsController::class, 'scheduleMessage']);
Route::get('/sms/scheduled/{id}', [SmsController::class, 'getScheduledMessage']);
Route::get('/sms/scheduled', [SmsController::class, 'listScheduledMessages']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/schedule-sms-messages-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Queue jobs not processing | Messages remain in "pending" status and never transition to "sent" or "failed". | Ensure the queue worker is running with `php artisan queue:work` in a separate terminal. Check that `QUEUE_CONNECTION` in `.env` is set to a valid driver (database or redis). Verify the jobs table exists by running `php artisan migrate`. Check Laravel logs in `storage/logs/` for queue-related errors. |
| Authentication Error (401) | The job fails with "Authentication failed" and error_message contains "Invalid API key". | Verify your `TELNYX_API_KEY` in the `.env` file matches the key from the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes around the key value. Restart the queue worker after updating `.env` to pick up the new credentials. |
| Invalid Phone Number Format | The request returns a 400 validation error or the job fails with an API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Scheduled time in the past | The request returns a 400 validation error stating "scheduled_at must be after now". | Ensure the `scheduled_at` timestamp is in the future. Use the format `Y-m-d H:i:s` (e.g., `2026-06-24 15:30:00`). Check your server's system time is correct. When testing, schedule messages at least 1 minute in the future. |
| Rate limit errors | The job fails with "API error" and retries multiple times, then marks as failed. | The Telnyx API rate limit was exceeded. The job automatically retries after 60 seconds on rate limit errors. Monitor your sending volume and implement backoff strategies if sending bulk messages. Consider using Laravel's built-in rate limiting or implementing a custom queue middleware. |

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

- [Send Bulk SMS Messages](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/send-bulk-sms).
- [Receive SMS Webhooks with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/otp-2fa).
