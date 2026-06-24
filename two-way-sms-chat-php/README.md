# Two Way SMS with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that sends and receives SMS messages using the Telnyx PHP SDK. This tutorial demonstrates bidirectional SMS communication: outbound message sending with proper error handling, and inbound webhook handling for received messages. You'll configure a Messaging Profile with a webhook URL, process incoming SMS events, and maintain a conversation history.

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
- A Telnyx phone number enabled for SMS (inbound and outbound).
- A publicly accessible URL for webhook delivery (ngrok, Cloudflare Tunnel, or deployed server).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a controller to handle SMS sending. Run:

```bash
php artisan make:controller SmsController
```

Edit `app/Http/Controllers/SmsController.php`:

```php
<?php

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

    /**
     * Send an SMS message.
     */
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

            // Store message in database for conversation history.
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

    /**
     * Retrieve conversation history with a phone number.
     */
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
```

Create a webhook controller to handle inbound SMS. Run:

```bash
php artisan make:controller WebhookController
```

Edit `app/Http/Controllers/WebhookController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Models\SmsMessage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class WebhookController extends Controller
{
    /**
     * Handle inbound SMS webhook from Telnyx.
     *
     * Telnyx sends a POST request with event data when an SMS is received.
     * Event type: message.received
     */
    public function handleSmsWebhook(Request $request): JsonResponse
    {
        // Log the raw webhook for debugging.
        Log::info('SMS Webhook received', $request->all());

        $data = $request->all();

        // Validate webhook signature (optional but recommended for production).
        // See Telnyx docs for signature verification.

        // Extract event data.
        $eventType = $data['data']['event_type'] ?? null;

        if ($eventType === 'message.received') {
            $messageData = $data['data'];

            // Store inbound message in database.
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

        // Handle other event types (message.sent, message.finalized, etc.).
        if ($eventType === 'message.finalized') {
            $messageData = $data['data'];
            $status = $messageData['to'][0]['status'] ?? 'unknown';

            // Update message status in database.
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
```

Register the webhook route. Edit `routes/api.php`:

```php
<?php

use App\Http\Controllers\SmsController;
use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::post('/sms/send', [SmsController::class, 'send']);
Route::get('/sms/conversation', [SmsController::class, 'conversation']);
Route::post('/webhooks/sms', [WebhookController::class, 'handleSmsWebhook']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/two-way-sms-chat-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (400) | The endpoint returns `{"error": "Invalid API key: ..."}` when sending SMS. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Laravel server after updating the `.env` file. Use `php artisan config:cache` to refresh cached configuration if needed. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command and database records to use properly formatted numbers. |
| Webhook Not Receiving Events | Inbound SMS are not being stored in the database; the webhook endpoint is not being called. | Verify the webhook URL in the [Telnyx Portal](https://portal.telnyx.com) Messaging Profile settings matches your public URL (e.g., `https://abc123.ngrok.io/api/webhooks/sms`). Ensure your server is running and publicly accessible. Check Laravel logs with `tail -f storage/logs/laravel.log` for webhook delivery errors. Confirm the route is registered in `routes/api.php` and accessible without authentication. |
| Database Migration Fails | Running `php artisan migrate` returns an error about the `sms_messages` table. | Ensure your database connection is configured correctly in `.env` (check `DB_HOST`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`). Run `php artisan migrate:fresh` to reset migrations if needed. Verify the migration file exists in `database/migrations/` and contains valid SQL syntax. |
| Rate Limit Errors (429) | Requests return `{"error": "Rate limit exceeded. Please slow down."}`. | Telnyx enforces rate limits on API calls. Implement exponential backoff in your code: catch `RateLimitException` and retry after a delay. For bulk messaging, use a queue system like Laravel's built-in queue with delayed jobs. Space out requests to avoid hitting limits. |

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

- [Receive SMS Webhooks with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/receive-sms-webhook).
- [Send Bulk SMS Messages with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/otp-2fa).
