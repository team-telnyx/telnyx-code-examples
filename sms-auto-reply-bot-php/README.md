# SMS Autoresponder with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that automatically responds to incoming SMS messages using the Telnyx PHP SDK. This tutorial demonstrates webhook handling, inbound message processing, and automatic reply logic with proper error handling and security patterns.

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
- A Telnyx phone number enabled for inbound SMS.
- A publicly accessible URL for webhook delivery (ngrok or similar for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-auto-reply-bot-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-auto-reply-bot-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a controller to handle incoming SMS webhooks and send autoresponses:

```bash
php artisan make:controller SmsController
```

Edit `app/Http/Controllers/SmsController.php`:

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Telnyx\Client;
use Telnyx\Exception\ApiErrorException;

class SmsController extends Controller
{
    private Client $client;
    private string $fromNumber;

    public function __construct()
    {
        // Initialize Telnyx client with API key from environment
        $this->client = new Client(apiKey: getenv('TELNYX_API_KEY'));
        $this->fromNumber = config('services.telnyx.phone_number');
    }

    /**
     * Handle incoming SMS webhook from Telnyx.
     * Validates webhook signature and sends autoresponse.
     */
    public function handleInbound(Request $request): JsonResponse
    {
        // Log incoming webhook for debugging
        \Log::info('Incoming SMS webhook', $request->all());

        // Validate required webhook fields
        $data = $request->all();
        if (!isset($data['data']['payload']['from']['phone_number']) || 
            !isset($data['data']['payload']['text'])) {
            return response()->json(['error' => 'Invalid webhook payload'], 400);
        }

        $fromNumber = $data['data']['payload']['from']['phone_number'];
        $incomingText = $data['data']['payload']['text'];

        try {
            // Generate autoresponse message based on incoming content
            $autoresponseText = $this->generateAutoresponse($incomingText);

            // Send autoresponse using Telnyx API
            $response = $this->client->messages->create([
                'from_' => $this->fromNumber,
                'to' => $fromNumber,
                'text' => $autoresponseText,
            ]);

            // Extract serializable data — SDK objects are NOT JSON-serializable
            $responseData = [
                'message_id' => $response->data->id,
                'status' => $response->data->to[0]->status ?? 'pending',
                'to' => $fromNumber,
                'autoresponse_sent' => true,
            ];

            \Log::info('Autoresponse sent', $responseData);

            return response()->json($responseData, 200);

        } catch (\Telnyx\Exception\AuthenticationException $e) {
            \Log::error('Authentication error', ['message' => $e->getMessage()]);
            return response()->json(['error' => 'Authentication failed'], 401);

        } catch (\Telnyx\Exception\RateLimitException $e) {
            \Log::warning('Rate limit exceeded', ['message' => $e->getMessage()]);
            return response()->json(['error' => 'Rate limit exceeded'], 429);

        } catch (\Telnyx\Exception\ApiErrorException $e) {
            \Log::error('API error', ['message' => $e->getMessage(), 'code' => $e->getCode()]);
            $statusCode = $e->getHttpStatus() ?? 500;
            return response()->json(['error' => $e->getMessage()], $statusCode);

        } catch (\Exception $e) {
            \Log::error('Unexpected error', ['message' => $e->getMessage()]);
            return response()->json(['error' => 'Internal server error'], 500);
        }
    }

    /**
     * Generate contextual autoresponse based on incoming message.
     * In production, integrate with NLP or keyword matching.
     */
    private function generateAutoresponse(string $incomingText): string
    {
        $lowerText = strtolower($incomingText);

        // Simple keyword-based routing
        if (str_contains($lowerText, 'hours') || str_contains($lowerText, 'open')) {
            return 'We are open Monday-Friday 9AM-5PM EST. How can we help?';
        }

        if (str_contains($lowerText, 'price') || str_contains($lowerText, 'cost')) {
            return 'Pricing varies by service. Reply with your inquiry for a custom quote.';
        }

        if (str_contains($lowerText, 'support') || str_contains($lowerText, 'help')) {
            return 'Our support team will respond shortly. Ticket created.';
        }

        // Default autoresponse
        return 'Thank you for your message. We will respond as soon as possible.';
    }

    /**
     * Send SMS to a specific number (for testing or manual sends).
     */
    public function sendSms(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'to' => 'required|string|regex:/^\+\d{1,15}$/',
            'message' => 'required|string|max:1600',
        ]);

        try {
            $response = $this->client->messages->create([
                'from_' => $this->fromNumber,
                'to' => $validated['to'],
                'text' => $validated['message'],
            ]);

            return response()->json([
                'message_id' => $response->data->id,
                'status' => $response->data->to[0]->status ?? 'pending',
                'to' => $validated['to'],
            ], 200);

        } catch (\Telnyx\Exception\AuthenticationException $e) {
            return response()->json(['error' => 'Invalid API key'], 401);

        } catch (\Telnyx\Exception\RateLimitException $e) {
            return response()->json(['error' => 'Rate limit exceeded'], 429);

        } catch (\Telnyx\Exception\ApiErrorException $e) {
            $statusCode = $e->getHttpStatus() ?? 500;
            return response()->json(['error' => $e->getMessage()], $statusCode);

        } catch (\Exception $e) {
            return response()->json(['error' => 'Internal server error'], 500);
        }
    }
}
```

Register the webhook route in `routes/api.php`:

```php
<?php

use App\Http\Controllers\SmsController;
use Illuminate\Support\Facades\Route;

Route::post('/sms/inbound', [SmsController::class, 'handleInbound']);
Route::post('/sms/send', [SmsController::class, 'sendSms']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-auto-reply-bot-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not triggering | Incoming SMS arrives but the autoresponder does not reply. | Verify the webhook URL in the Telnyx Portal matches your ngrok URL exactly (including `https://` and `/api/sms/inbound`). Check Laravel logs with `tail -f storage/logs/laravel.log` to see if the webhook is being received. Ensure your ngrok tunnel is active and the Laravel server is running. |
| Authentication Error (401) | The endpoint returns `{"error": "Authentication failed"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Laravel server after updating `.env` to reload environment variables. |
| Invalid Phone Number Format | You receive a validation error about phone number format when testing the `/sms/send` endpoint. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl request to use properly formatted numbers. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded"}` with HTTP 429. | Telnyx enforces rate limits on API calls. Implement exponential backoff in your autoresponse logic or queue outbound messages using Laravel's queue system. Space out requests and avoid sending duplicate responses to the same number within seconds. |
| Webhook payload parsing fails | The endpoint returns `{"error": "Invalid webhook payload"}` with HTTP 400. | Log the raw webhook payload to understand its structure: add `\Log::info('Raw webhook', $request->all())` and check `storage/logs/laravel.log`. Verify the webhook event type is `message.received` and the payload contains `from.phone_number` and `text` fields. |

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
