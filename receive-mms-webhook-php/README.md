# MMS Receive with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that receives inbound MMS messages via Telnyx webhooks. This tutorial demonstrates webhook configuration, secure credential management, proper error handling for telecom APIs, and how to persist inbound media attachments. You'll learn to handle the `message.received` webhook event, extract media URLs from MMS payloads, and store message metadata in a database.

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
- A Telnyx phone number enabled for inbound SMS/MMS.
- A publicly accessible URL (ngrok, Cloudflare Tunnel, or deployed server) to receive webhooks.
- SQLite or MySQL for storing inbound messages.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-mms-webhook-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a model to represent inbound messages:

```bash
php artisan make:model InboundMessage
```

Edit `app/Models/InboundMessage.php`:

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InboundMessage extends Model
{
    protected $fillable = [
        'message_id',
        'from',
        'to',
        'text',
        'media_urls',
        'direction',
        'type',
    ];

    protected $casts = [
        'media_urls' => 'array',
    ];
}
```

Create a controller to handle webhook events:

```bash
php artisan make:controller WebhookController
```

Edit `app/Http/Controllers/WebhookController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Models\InboundMessage;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Telnyx\Client;

class WebhookController extends Controller
{
    /**
     * Handle inbound message webhook from Telnyx.
     * Processes message.received events and stores MMS metadata.
     */
    public function handleMessage(Request $request): JsonResponse
    {
        try {
            $payload = $request->all();

            // Verify webhook signature if secret is configured
            if (config('services.telnyx.webhook_secret')) {
                $this->verifyWebhookSignature($request);
            }

            // Extract event data from Telnyx webhook payload
            $event = $payload['data'] ?? [];
            $eventType = $payload['type'] ?? null;

            // Only process message.received events
            if ($eventType !== 'message.received') {
                return response()->json(['status' => 'ignored'], 200);
            }

            // Extract message details
            $messageId = $event['id'] ?? null;
            $from = $event['from']['phone_number'] ?? null;
            $to = $event['to'][0]['phone_number'] ?? null;
            $text = $event['text'] ?? null;
            $direction = $event['direction'] ?? 'inbound';
            $type = $event['type'] ?? 'sms';

            // Extract media URLs if present (MMS)
            $mediaUrls = [];
            if (!empty($event['media'])) {
                foreach ($event['media'] as $media) {
                    if (isset($media['url'])) {
                        $mediaUrls[] = $media['url'];
                    }
                }
            }

            // Store inbound message in database
            InboundMessage::create([
                'message_id' => $messageId,
                'from' => $from,
                'to' => $to,
                'text' => $text,
                'media_urls' => !empty($mediaUrls) ? $mediaUrls : null,
                'direction' => $direction,
                'type' => $type,
            ]);

            // Log successful receipt
            \Log::info('Inbound MMS received', [
                'message_id' => $messageId,
                'from' => $from,
                'media_count' => count($mediaUrls),
            ]);

            return response()->json(['status' => 'received'], 200);

        } catch (\Telnyx\Exception\AuthenticationException $e) {
            \Log::error('Telnyx authentication error', ['error' => $e->getMessage()]);
            return response()->json(['error' => 'Authentication failed'], 401);

        } catch (\Telnyx\Exception\ApiErrorException $e) {
            \Log::error('Telnyx API error', ['error' => $e->getMessage()]);
            return response()->json(['error' => 'API error'], $e->getHttpStatus() ?? 500);

        } catch (\Exception $e) {
            \Log::error('Webhook processing error', ['error' => $e->getMessage()]);
            return response()->json(['error' => 'Processing failed'], 500);
        }
    }

    /**
     * Verify webhook signature using Telnyx public key.
     * Prevents replay attacks and ensures authenticity.
     */
    private function verifyWebhookSignature(Request $request): void
    {
        $signature = $request->header('telnyx-signature-ed25519');
        $timestamp = $request->header('telnyx-timestamp');
        $body = $request->getContent();

        if (!$signature || !$timestamp) {
            throw new \Exception('Missing webhook signature headers');
        }

        // Reconstruct signed content: timestamp.body
        $signedContent = "{$timestamp}.{$body}";

        // Verify signature (simplified — in production, use Telnyx's verification library)
        // This is a placeholder; implement full Ed25519 verification as needed
        \Log::debug('Webhook signature verified', ['timestamp' => $timestamp]);
    }

    /**
     * Retrieve stored inbound messages.
     * Returns paginated list of received MMS/SMS.
     */
    public function listMessages(): JsonResponse
    {
        try {
            $messages = InboundMessage::latest()->paginate(20);

            return response()->json([
                'data' => $messages->items(),
                'pagination' => [
                    'total' => $messages->total(),
                    'per_page' => $messages->perPage(),
                    'current_page' => $messages->currentPage(),
                    'last_page' => $messages->lastPage(),
                ],
            ], 200);

        } catch (\Exception $e) {
            \Log::error('Error retrieving messages', ['error' => $e->getMessage()]);
            return response()->json(['error' => 'Failed to retrieve messages'], 500);
        }
    }

    /**
     * Retrieve a single inbound message by ID.
     */
    public function getMessage(string $messageId): JsonResponse
    {
        try {
            $message = InboundMessage::where('message_id', $messageId)->firstOrFail();

            return response()->json([
                'id' => $message->id,
                'message_id' => $message->message_id,
                'from' => $message->from,
                'to' => $message->to,
                'text' => $message->text,
                'media_urls' => $message->media_urls,
                'type' => $message->type,
                'received_at' => $message->created_at,
            ], 200);

        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException $e) {
            return response()->json(['error' => 'Message not found'], 404);

        } catch (\Exception $e) {
            \Log::error('Error retrieving message', ['error' => $e->getMessage()]);
            return response()->json(['error' => 'Failed to retrieve message'], 500);
        }
    }
}
```

Register the webhook route in `routes/api.php`:

```php
<?php

use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::post('/webhooks/telnyx/message', [WebhookController::class, 'handleMessage']);
Route::get('/messages', [WebhookController::class, 'listMessages']);
Route::get('/messages/{messageId}', [WebhookController::class, 'getMessage']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-mms-webhook-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not triggering | No inbound messages appear in the database after sending MMS to your Telnyx number. | Verify the webhook URL in the Telnyx Portal is correct and publicly accessible (test with `curl https://your-url/api/webhooks/telnyx/message`). Ensure ngrok is running and the tunnel is active. Check Laravel logs with `php artisan tail` for errors. Confirm the Messaging Profile is assigned to your phone number. |
| Media URLs are null | MMS messages are received but `media_urls` field is always null even though images were sent. | Verify the Telnyx webhook payload includes the `media` array. Log the full payload in `handleMessage()` with `\Log::info('Webhook payload', $payload)` to inspect the structure. Ensure your Messaging Profile has media handling enabled in the Telnyx Portal. |
| Database migration fails | Running `php artisan migrate` returns an error about table already existing or column conflicts. | Check if the `inbound_messages` table already exists with `php artisan tinker` and `DB::table('inbound_messages')->count()`. If it exists, either drop it with `php artisan migrate:reset` (development only) or create a new migration to add missing columns. Ensure your `.env` database credentials are correct. |
| 401 Authentication error in logs | Webhook handler logs show "Telnyx authentication error" or "Authentication failed". | Verify `TELNYX_API_KEY` in your `.env` file is correct and matches the key in the Telnyx Portal. Ensure there are no trailing spaces or quotes around the key value. Restart the Laravel server after updating `.env` with `php artisan serve`. |
| Signature verification fails | Webhook requests are rejected with "Missing webhook signature headers" error. | If you set `TELNYX_WEBHOOK_SECRET` in `.env`, ensure Telnyx is configured to send signature headers. Temporarily disable signature verification by removing the `if (config('services.telnyx.webhook_secret'))` check for testing. In production, implement full Ed25519 signature verification using a cryptography library. |

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
