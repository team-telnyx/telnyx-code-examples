# SMS Notifications with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that sends SMS notifications using the Telnyx PHP SDK. This tutorial demonstrates how to integrate Telnyx messaging into a Laravel service layer, handle errors gracefully, and manage credentials securely via environment variables. You'll create a reusable notification system that can send SMS alerts for user events like password resets, order confirmations, and account updates.

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
- A publicly accessible URL for webhook testing (optional, for inbound messages).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-notifications-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to encapsulate SMS sending logic. Generate a new service:

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
use Illuminate\Support\Facades\Log;

class TelnyxSmsService
{
    private Client $client;
    private string $fromNumber;

    public function __construct()
    {
        // Initialize Telnyx client with API key from environment
        $this->client = new Client(apiKey: config('services.telnyx.api_key'));
        $this->fromNumber = config('services.telnyx.phone_number');

        if (!$this->fromNumber) {
            throw new \RuntimeException('TELNYX_PHONE_NUMBER not configured');
        }
    }

    /**
     * Send an SMS message to a recipient.
     *
     * @param string $toNumber Recipient phone number in E.164 format (e.g., +15551234567)
     * @param string $message SMS message text
     * @return array Serializable response data with message ID and status
     * @throws \RuntimeException If phone number format is invalid
     */
    public function sendSms(string $toNumber, string $message): array
    {
        // Validate E.164 format to prevent API errors
        if (!str_starts_with($toNumber, '+')) {
            throw new \RuntimeException('Phone number must be in E.164 format (e.g., +15551234567)');
        }

        // Truncate message if it exceeds SMS length limits (160 chars for single segment)
        // Telnyx will auto-split longer messages into multiple segments
        if (strlen($message) > 1600) {
            Log::warning('SMS message truncated', [
                'original_length' => strlen($message),
                'to' => $toNumber,
            ]);
            $message = substr($message, 0, 1600);
        }

        try {
            // Create message via Telnyx API
            $response = $this->client->messages->send([
                'from_' => $this->fromNumber,
                'to' => $toNumber,
                'text' => $message,
            ]);

            // Extract serializable data — SDK objects are NOT JSON-serializable
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

    /**
     * Send a notification SMS (e.g., password reset, order confirmation).
     *
     * @param string $toNumber Recipient phone number
     * @param string $type Notification type (password_reset, order_confirmation, etc.)
     * @param array $data Additional data for the notification
     * @return array Response data
     */
    public function sendNotification(string $toNumber, string $type, array $data = []): array
    {
        $message = $this->buildNotificationMessage($type, $data);
        return $this->sendSms($toNumber, $message);
    }

    /**
     * Build notification message text based on type.
     *
     * @param string $type Notification type
     * @param array $data Data for message interpolation
     * @return string Formatted message text
     */
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
```

Create a controller to handle SMS notification requests:

```bash
php artisan make:controller SmsNotificationController
```

Edit `app/Http/Controllers/SmsNotificationController.php`:

```php
<?php

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

    /**
     * Send a single SMS notification.
     *
     * POST /api/sms/send
     * Body: { "to": "+15551234567", "type": "password_reset", "data": { "code": "123456" } }
     */
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
                // For custom messages, use the message field directly
                $result = $this->smsService->sendSms(
                    $validated['to'],
                    $validated['message']
                );
            } else {
                // For predefined notification types, use the notification builder
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

    /**
     * Send bulk SMS notifications to multiple recipients.
     *
     * POST /api/sms/send-bulk
     * Body: { "recipients": ["+15551234567", "+15559876543"], "type": "order_confirmation", "data": {...} }
     */
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
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\SmsNotificationController;
use Illuminate\Support\Facades\Route;

Route::post('/sms/send', [SmsNotificationController::class, 'send']);
Route::post('/sms/send-bulk', [SmsNotificationController::class, 'sendBulk']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-notifications-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid Telnyx API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Laravel server with `php artisan serve`. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a validation error about the `to` field. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Environment Variable Not Set | The application throws `RuntimeException: TELNYX_PHONE_NUMBER not configured` on first request. | Confirm your `.env` file exists in the project root and contains both `TELNYX_API_KEY` and `TELNYX_PHONE_NUMBER`. Run `php artisan config:cache` to refresh cached configuration, then restart the server. Verify that `config/services.php` includes the telnyx configuration block. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please try again later."}` with HTTP 429. | Telnyx enforces rate limits on API requests. Implement exponential backoff in your bulk sending logic or use Laravel queues to distribute messages over time. For production, consider using `php artisan queue:work` with delayed job dispatch. |
| Message Truncation Warning | You see a log entry about message truncation when sending long SMS. | SMS messages longer than 160 characters are split into multiple segments, each billed separately. The service truncates messages exceeding 1600 characters. For longer content, consider sending a link instead or splitting the message into multiple requests. |

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
- [Send Bulk SMS Messages](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/otp-2fa).
