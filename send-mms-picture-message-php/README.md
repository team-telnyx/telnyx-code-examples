# MMS Send with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel endpoint that sends MMS messages with media attachments using the Telnyx PHP SDK. This tutorial demonstrates the new client-based initialization pattern, proper error handling for telecom APIs, secure credential management via environment variables, and Laravel's idiomatic patterns for request validation and response serialization.

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
- A Telnyx phone number enabled for outbound MMS.
- A publicly accessible URL or ngrok tunnel for testing (optional, for webhook testing).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to encapsulate MMS sending logic. Generate a new service:

```bash
php artisan make:service TelnyxMmsService
```

Edit `app/Services/TelnyxMmsService.php`:

```php
<?php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;

class TelnyxMmsService
{
    private Client $client;
    private string $fromNumber;

    public function __construct()
    {
        $this->client = new Client(apiKey: config('services.telnyx.api_key'));
        $this->fromNumber = config('services.telnyx.phone_number');

        if (!$this->fromNumber) {
            throw new \RuntimeException('TELNYX_PHONE_NUMBER environment variable not set');
        }
    }

    /**
     * Send MMS message with media attachments.
     *
     * @param string $toNumber Recipient phone number in E.164 format.
     * @param string $message Message text content.
     * @param array $mediaUrls Array of publicly accessible media URLs (images, videos, etc.).
     * @return array JSON-serializable response data.
     * @throws \InvalidArgumentException If phone number format is invalid.
     * @throws ApiException If Telnyx API call fails.
     */
    public function sendMms(string $toNumber, string $message, array $mediaUrls): array
    {
        // Validate E.164 format to prevent API errors
        if (!str_starts_with($toNumber, '+')) {
            throw new \InvalidArgumentException(
                'Phone number must be in E.164 format (e.g., +15551234567)'
            );
        }

        if (empty($mediaUrls)) {
            throw new \InvalidArgumentException(
                'At least one media URL is required for MMS'
            );
        }

        // Validate media URLs are accessible
        foreach ($mediaUrls as $url) {
            if (!filter_var($url, FILTER_VALIDATE_URL)) {
                throw new \InvalidArgumentException(
                    "Invalid media URL: {$url}"
                );
            }
        }

        // Create MMS message via Telnyx API
        $response = $this->client->messages->create([
            'from_' => $this->fromNumber,
            'to' => $toNumber,
            'text' => $message,
            'media_urls' => $mediaUrls,
        ]);

        // Extract serializable data — SDK objects are NOT JSON-serializable
        return [
            'message_id' => $response->data->id,
            'status' => $response->data->to[0]->status ?? 'pending',
            'from' => $this->fromNumber,
            'to' => $toNumber,
            'media_count' => count($mediaUrls),
        ];
    }
}
```

Create a controller to handle HTTP requests. Generate a new controller:

```bash
php artisan make:controller MmsController
```

Edit `app/Http/Controllers/MmsController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\TelnyxMmsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;

class MmsController extends Controller
{
    public function __construct(private TelnyxMmsService $mmsService)
    {
    }

    /**
     * Send MMS message endpoint.
     *
     * POST /api/mms/send
     * {
     *   "to": "+15559876543",
     *   "message": "Check out this image!",
     *   "media_urls": ["https://example.com/image.jpg"]
     * }
     */
    public function send(Request $request): JsonResponse
    {
        // Validate request input
        $validated = $request->validate([
            'to' => 'required|string|regex:/^\+\d{1,15}$/',
            'message' => 'required|string|max:1000',
            'media_urls' => 'required|array|min:1',
            'media_urls.*' => 'required|url',
        ]);

        try {
            $result = $this->mmsService->sendMms(
                $validated['to'],
                $validated['message'],
                $validated['media_urls']
            );

            return response()->json($result, 200);

        } catch (AuthenticationException) {
            return response()->json(['error' => 'Invalid API key'], 401);

        } catch (RateLimitException) {
            return response()->json(
                ['error' => 'Rate limit exceeded. Please slow down.'],
                429
            );

        } catch (ApiException $e) {
            return response()->json(
                [
                    'error' => $e->getMessage(),
                    'status_code' => $e->getHttpStatus(),
                ],
                $e->getHttpStatus() ?? 500
            );

        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 400);

        } catch (\Exception $e) {
            return response()->json(
                ['error' => 'Network error connecting to Telnyx'],
                503
            );
        }
    }
}
```

Register the route in `routes/api.php`:

```php
<?php

use App\Http\Controllers\MmsController;
use Illuminate\Support\Facades\Route;

Route::post('/mms/send', [MmsController::class, 'send']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-mms-picture-message-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Laravel server with `php artisan serve`. Clear the config cache with `php artisan config:clear` if changes don't take effect. |
| Invalid Phone Number Format | You receive a 400 error stating "The to field format is invalid" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. The regex validation in the controller enforces this format. |
| Media URL Validation Fails | The endpoint returns `{"error": "Invalid media URL: ..."}` or validation error for `media_urls.*`. | Ensure all media URLs are publicly accessible and use valid HTTP/HTTPS protocols. Test URLs in your browser first to confirm they load. URLs must be complete (e.g., `https://example.com/image.jpg`, not `example.com/image.jpg`). Verify the media file format is supported by MMS (JPEG, PNG, GIF, MP4, etc.). |
| Environment Variable Not Set | The application throws `RuntimeException: TELNYX_PHONE_NUMBER environment variable not set` on first request. | Confirm your `.env` file exists in the project root and contains both `TELNYX_API_KEY` and `TELNYX_PHONE_NUMBER`. Run `php artisan config:clear` to clear cached configuration. Ensure the `.env` file is not listed in `.gitignore` (it should be for security). Restart the Laravel server after updating `.env`. |
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx enforces rate limits on API calls. Implement exponential backoff in your application: wait 1 second, then 2 seconds, then 4 seconds between retries. For bulk MMS sending, use a queue system like Laravel's built-in queue with delayed jobs. Monitor your usage in the [Telnyx Portal](https://portal.telnyx.com) to understand your rate limit tier. |

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

- [Send Bulk SMS Messages](/tutorials/sms/php/send-bulk-sms).
- [Receive SMS Webhooks with Laravel](/tutorials/sms/php/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/php/otp-2fa).
