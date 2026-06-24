# Number Lookup with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that performs number lookups using the Telnyx SMS API. This tutorial demonstrates how to validate phone numbers, retrieve carrier information, and format responses for web clients. You'll learn the new SDK initialization pattern, proper error handling for telecom APIs, and secure credential management via environment variables in a Laravel context.

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
- A publicly accessible URL for webhook testing (ngrok or similar for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/phone-number-lookup-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle number lookup logic. Generate it using Artisan:

```bash
php artisan make:service NumberLookupService
```

Edit `app/Services/NumberLookupService.php`:

```php
<?php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;

class NumberLookupService
{
    private Client $client;

    public function __construct()
    {
        // Initialize client with the new SDK pattern
        $this->client = new Client(apiKey: getenv('TELNYX_API_KEY'));
    }

    /**
     * Perform a number lookup and return carrier/format information.
     * 
     * @param string $phoneNumber Phone number in E.164 format (e.g., +15551234567)
     * @return array JSON-serializable lookup result
     * @throws \Exception
     */
    public function lookup(string $phoneNumber): array
    {
        // Validate E.164 format to prevent API errors
        if (!preg_match('/^\+\d{1,15}$/', $phoneNumber)) {
            throw new \InvalidArgumentException(
                'Phone number must be in E.164 format (e.g., +15551234567)'
            );
        }

        try {
            // Call the number lookup endpoint via the SDK
            // The SDK abstracts the REST call to GET /v2/number_lookup/{phone_number}
            $response = $this->client->numberLookup->retrieve($phoneNumber);

            // Extract serializable data — SDK objects are NOT JSON-serializable
            return [
                'phone_number' => $response->data->phone_number ?? $phoneNumber,
                'carrier_name' => $response->data->carrier_name ?? 'Unknown',
                'carrier_type' => $response->data->carrier_type ?? 'Unknown',
                'country_code' => $response->data->country_code ?? null,
                'number_type' => $response->data->number_type ?? 'Unknown',
                'portability_status' => $response->data->portability_status ?? 'Unknown',
            ];
        } catch (ApiException $e) {
            // Re-throw with context for the controller to handle
            throw new \Exception('Number lookup failed: ' . $e->getMessage(), $e->getCode(), $e);
        }
    }
}
```

Generate a controller to handle HTTP requests:

```bash
php artisan make:controller NumberLookupController
```

Edit `app/Http/Controllers/NumberLookupController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\NumberLookupService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;

class NumberLookupController extends Controller
{
    private NumberLookupService $lookupService;

    public function __construct(NumberLookupService $lookupService)
    {
        $this->lookupService = $lookupService;
    }

    /**
     * Perform a number lookup via POST request.
     * 
     * Expected JSON body: {"phone_number": "+15551234567"}
     */
    public function lookup(Request $request): JsonResponse
    {
        // Validate incoming request
        $validated = $request->validate([
            'phone_number' => 'required|string',
        ]);

        $phoneNumber = $validated['phone_number'];

        try {
            $result = $this->lookupService->lookup($phoneNumber);
            return response()->json($result, 200);

        } catch (AuthenticationException $e) {
            // 401: Invalid API key
            return response()->json([
                'error' => 'Invalid API key',
                'details' => $e->getMessage(),
            ], 401);

        } catch (RateLimitException $e) {
            // 429: Too many requests
            return response()->json([
                'error' => 'Rate limit exceeded. Please slow down.',
                'details' => $e->getMessage(),
            ], 429);

        } catch (ApiException $e) {
            // Other API errors (4xx/5xx)
            $statusCode = $e->getCode() ?: 400;
            return response()->json([
                'error' => 'API error',
                'details' => $e->getMessage(),
                'status_code' => $statusCode,
            ], $statusCode);

        } catch (\InvalidArgumentException $e) {
            // Validation error (bad phone number format)
            return response()->json([
                'error' => $e->getMessage(),
            ], 400);

        } catch (\Exception $e) {
            // Catch-all for unexpected errors
            return response()->json([
                'error' => 'Internal server error',
                'details' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Batch lookup multiple phone numbers.
     * 
     * Expected JSON body: {"phone_numbers": ["+15551234567", "+447700900123"]}
     */
    public function batchLookup(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'phone_numbers' => 'required|array',
            'phone_numbers.*' => 'string',
        ]);

        $results = [];
        $errors = [];

        foreach ($validated['phone_numbers'] as $phoneNumber) {
            try {
                $results[$phoneNumber] = $this->lookupService->lookup($phoneNumber);
            } catch (\Exception $e) {
                $errors[$phoneNumber] = $e->getMessage();
            }
        }

        return response()->json([
            'results' => $results,
            'errors' => $errors,
            'total' => count($validated['phone_numbers']),
            'successful' => count($results),
            'failed' => count($errors),
        ], 200);
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\NumberLookupController;
use Illuminate\Support\Facades\Route;

Route::post('/number-lookup', [NumberLookupController::class, 'lookup']);
Route::post('/number-lookup/batch', [NumberLookupController::class, 'batchLookup']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Laravel server with `php artisan serve`. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Environment Variable Not Set | The application raises an error about missing `TELNYX_API_KEY` on startup or first request. | Confirm your `.env` file exists in the project root and contains the variable. Ensure the file is named exactly `.env` (not `.env.example` or `env`). Run `php artisan config:cache` to refresh cached configuration, then restart the server. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API enforces rate limits. Implement exponential backoff in your batch lookup logic or add a delay between requests. For production, consider caching lookup results to avoid repeated queries for the same numbers. |
| Batch Lookup Partial Failures | Some phone numbers in a batch request fail while others succeed. | This is expected behavior. The batch endpoint returns both successful results and errors keyed by phone number. Check the `errors` object in the response to identify which numbers failed and why. Invalid formats are caught before the API call; other failures are API-level errors. |

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

- [Send a Single SMS with PHP and Laravel](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/send-single-sms).
- [Receive SMS Webhooks with PHP and Laravel](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/otp-2fa).
