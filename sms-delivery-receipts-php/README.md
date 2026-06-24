# Delivery Receipts with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that handles SMS delivery receipts via webhooks. This tutorial demonstrates how to receive and process `message.finalized` webhook events from Telnyx, store delivery status in a database, and query message delivery history. You'll learn the new PHP SDK client initialization pattern, proper webhook validation, and secure credential management via environment variables.

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
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound SMS.
- Composer (PHP package manager).
- A publicly accessible URL for webhook delivery (ngrok, Cloudflare Tunnel, or deployed server).
- SQLite or MySQL database configured in your Laravel `.env`.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a controller to handle webhook events and send SMS messages:

```bash
php artisan make:controller SmsController
```

Edit `app/Http/Controllers/SmsController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Models\SmsMessage;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Telnyx\Client;

class SmsController extends Controller
{
    private Client $client;

    public function __construct()
    {
        // Initialize Telnyx client with API key from environment
        $this->client = new Client(apiKey: getenv('TELNYX_API_KEY'));
    }

    /**
     * Send an SMS message and store it in the database.
     */
    public function send(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'to' => 'required|string|regex:/^\+\d{1,15}$/',
            'message' => 'required|string|max:1600',
        ]);

        $fromNumber = getenv('TELNYX_PHONE_NUMBER');
        if (!$fromNumber) {
            return response()->json(['error' => 'TELNYX_PHONE_NUMBER not configured'], 500);
        }

        try {
            // Create message via Telnyx API
            $response = $this->client->messages->create([
                'from_' => $fromNumber,
                'to' => $validated['to'],
                'text' => $validated['message'],
            ]);

            // Store message record in database
            $smsMessage = SmsMessage::create([
                'message_id' => $response->data->id,
                'from_number' => $fromNumber,
                'to_number' => $validated['to'],
                'text' => $validated['message'],
                'direction' => 'outbound',
                'status' => 'queued',
            ]);

            return response()->json([
                'id' => $smsMessage->id,
                'message_id' => $smsMessage->message_id,
                'status' => $smsMessage->status,
                'to' => $smsMessage->to_number,
            ], 201);

        } catch (\Telnyx\AuthenticationError $e) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (\Telnyx\RateLimitError $e) {
            return response()->json(['error' => 'Rate limit exceeded'], 429);
        } catch (\Telnyx\APIStatusError $e) {
            return response()->json(['error' => $e->getMessage()], $e->status_code ?? 400);
        } catch (\Telnyx\APIConnectionError $e) {
            return response()->json(['error' => 'Network error connecting to Telnyx'], 503);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        }
    }

    /**
     * Handle incoming webhook events from Telnyx.
     * Processes message.finalized events to update delivery status.
     */
    public function webhook(Request $request): JsonResponse
    {
        $payload = $request->all();

        // Validate webhook signature (optional but recommended for production)
        // Telnyx sends X-Telnyx-Signature-ED25519 header for verification

        $eventType = $payload['data']['event_type'] ?? null;
        $messageId = $payload['data']['payload']['id'] ?? null;

        if (!$messageId) {
            return response()->json(['error' => 'Invalid webhook payload'], 400);
        }

        try {
            // Handle message.finalized events (delivery status updates)
            if ($eventType === 'message.finalized') {
                $this->handleMessageFinalized($payload['data']['payload']);
            }

            // Return 200 OK to acknowledge receipt
            return response()->json(['status' => 'received'], 200);

        } catch (\Exception $e) {
            // Log error but still return 200 to prevent Telnyx retries
            \Log::error('Webhook processing error: ' . $e->getMessage());
            return response()->json(['status' => 'received'], 200);
        }
    }

    /**
     * Process message.finalized webhook event.
     * Updates the SMS message record with final delivery status.
     */
    private function handleMessageFinalized(array $payload): void
    {
        $messageId = $payload['id'] ?? null;
        if (!$messageId) {
            return;
        }

        $smsMessage = SmsMessage::where('message_id', $messageId)->first();
        if (!$smsMessage) {
            return;
        }

        // Extract delivery status from the first recipient
        $recipients = $payload['to'] ?? [];
        if (!empty($recipients)) {
            $recipient = $recipients[0];
            $status = $recipient['status'] ?? 'unknown';
            $smsMessage->status = $status;

            // Update delivered_at timestamp if message was delivered
            if ($status === 'delivered') {
                $smsMessage->delivered_at = now();
            }

            // Store error message if delivery failed
            if ($status === 'failed' && isset($recipient['error'])) {
                $smsMessage->error_message = $recipient['error']['message'] ?? 'Unknown error';
            }

            $smsMessage->save();
        }
    }

    /**
     * Retrieve delivery status for a specific message.
     */
    public function status(string $messageId): JsonResponse
    {
        $smsMessage = SmsMessage::where('message_id', $messageId)->first();

        if (!$smsMessage) {
            return response()->json(['error' => 'Message not found'], 404);
        }

        return response()->json([
            'id' => $smsMessage->id,
            'message_id' => $smsMessage->message_id,
            'to' => $smsMessage->to_number,
            'status' => $smsMessage->status,
            'sent_at' => $smsMessage->sent_at,
            'delivered_at' => $smsMessage->delivered_at,
            'error_message' => $smsMessage->error_message,
        ]);
    }

    /**
     * List all messages with optional status filter.
     */
    public function list(Request $request): JsonResponse
    {
        $query = SmsMessage::query();

        if ($request->has('status')) {
            $query->where('status', $request->input('status'));
        }

        if ($request->has('direction')) {
            $query->where('direction', $request->input('direction'));
        }

        $messages = $query->orderBy('created_at', 'desc')
            ->paginate(20);

        return response()->json([
            'data' => $messages->map(fn($msg) => [
                'id' => $msg->id,
                'message_id' => $msg->message_id,
                'to' => $msg->to_number,
                'status' => $msg->status,
                'sent_at' => $msg->sent_at,
                'delivered_at' => $msg->delivered_at,
            ]),
            'pagination' => [
                'total' => $messages->total(),
                'per_page' => $messages->perPage(),
                'current_page' => $messages->currentPage(),
            ],
        ]);
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\SmsController;
use Illuminate\Support\Facades\Route;

Route::post('/sms/send', [SmsController::class, 'send']);
Route::post('/webhooks/sms', [SmsController::class, 'webhook']);
Route::get('/sms/{messageId}/status', [SmsController::class, 'status']);
Route::get('/sms/messages', [SmsController::class, 'list']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-delivery-receipts-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Laravel development server after updating `.env`. Run `php artisan config:cache` to refresh cached configuration. |
| Webhook Not Receiving Events | Webhooks are not being delivered to your endpoint. | Confirm your webhook URL is publicly accessible and matches the URL configured in the Telnyx Portal under Messaging > Messaging Profiles. If using ngrok, ensure the tunnel is active and the URL in your `.env` matches the ngrok URL. Check Laravel logs with `tail -f storage/logs/laravel.log` for incoming requests. Verify your firewall allows inbound HTTPS traffic on port 443. |
| Message Status Not Updating | Messages remain in "queued" status and never transition to "delivered" or "failed". | Ensure the webhook URL is correctly configured in the Telnyx Portal and is receiving POST requests. Check the `sms_messages` table to confirm records are being created. Verify the `message.finalized` event type is enabled in your Messaging Profile webhook settings. Review Laravel logs for any errors during webhook processing. Test webhook delivery using Telnyx Portal's webhook testing tool. |
| Database Migration Fails | Running `php artisan migrate` returns an error about table already existing or schema issues. | Ensure your database is properly configured in `.env` (check `DB_CONNECTION`, `DB_HOST`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`). If the table already exists, run `php artisan migrate:refresh` to reset migrations (warning: this deletes all data). For SQLite, ensure the `database/database.sqlite` file exists and is writable. |
| Invalid Phone Number Format | Requests return a validation error about the phone number format. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl commands to use properly formatted numbers. |

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

- [Send Bulk SMS Messages](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/send-bulk-sms).
- [Receive SMS Webhooks with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/otp-2fa).
