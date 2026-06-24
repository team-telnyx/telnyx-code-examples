# CNAM Lookup with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that performs CNAM (Caller ID Name) lookups using the Telnyx SIP Trunking API. This tutorial demonstrates how to retrieve caller identification information for inbound calls, implement proper error handling for telecom APIs, and integrate CNAM data into your call routing logic. CNAM lookups are essential for identifying callers before routing calls to your SIP endpoints.

## Who Is This For?

- **PHP developers** building sip features with Laravel.
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
- A Telnyx phone number enabled for inbound calls.
- Postman or curl for testing API endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-cnam-lookup-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle CNAM lookups. Generate a new service:

```bash
php artisan make:service CnamLookupService
```

Edit `app/Services/CnamLookupService.php`:

```php
<?php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;

class CnamLookupService
{
    private Client $client;

    public function __construct()
    {
        // Initialize Telnyx client with API key from environment
        $this->client = new Client(apiKey: getenv('TELNYX_API_KEY'));
    }

    /**
     * Perform CNAM lookup for a phone number.
     * 
     * @param string $phoneNumber Phone number in E.164 format (e.g., +15551234567)
     * @return array Caller name and associated metadata
     * @throws ApiException
     */
    public function lookup(string $phoneNumber): array
    {
        // Validate E.164 format to prevent API errors
        if (!preg_match('/^\+\d{1,15}$/', $phoneNumber)) {
            throw new \InvalidArgumentException(
                'Phone number must be in E.164 format (e.g., +15551234567)'
            );
        }

        // Call Telnyx CNAM lookup endpoint
        // Note: CNAM lookups are performed via REST API, not SDK method
        $response = $this->client->request(
            'GET',
            "/v2/cnam_lookups/{$phoneNumber}",
            []
        );

        // Extract serializable data from response
        return [
            'phone_number' => $phoneNumber,
            'caller_name' => $response['data']['caller_name'] ?? null,
            'carrier_name' => $response['data']['carrier_name'] ?? null,
            'phone_type' => $response['data']['phone_type'] ?? null,
            'country_code' => $response['data']['country_code'] ?? null,
            'lookup_status' => $response['data']['lookup_status'] ?? 'unknown',
        ];
    }
}
```

Create a controller to handle CNAM lookup requests:

```bash
php artisan make:controller CnamLookupController
```

Edit `app/Http/Controllers/CnamLookupController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\CnamLookupService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Exception\ApiException;

class CnamLookupController extends Controller
{
    private CnamLookupService $cnamService;

    public function __construct(CnamLookupService $cnamService)
    {
        $this->cnamService = $cnamService;
    }

    /**
     * Perform CNAM lookup for a given phone number.
     * 
     * @param Request $request HTTP request containing phone number
     * @return JsonResponse CNAM data or error response
     */
    public function lookup(Request $request): JsonResponse
    {
        // Validate incoming request
        $validated = $request->validate([
            'phone_number' => 'required|string',
        ]);

        $phoneNumber = $validated['phone_number'];

        try {
            // Perform CNAM lookup via service
            $result = $this->cnamService->lookup($phoneNumber);
            return response()->json($result, 200);

        } catch (\InvalidArgumentException $e) {
            // Handle validation errors (invalid phone format)
            return response()->json(['error' => $e->getMessage()], 400);
        }
    }

    /**
     * Batch CNAM lookup for multiple phone numbers.
     * 
     * @param Request $request HTTP request containing array of phone numbers
     * @return JsonResponse Array of CNAM results or error response
     */
    public function batchLookup(Request $request): JsonResponse
    {
        // Validate incoming request
        $validated = $request->validate([
            'phone_numbers' => 'required|array',
            'phone_numbers.*' => 'string',
        ]);

        $results = [];
        $errors = [];

        // Process each phone number
        foreach ($validated['phone_numbers'] as $phoneNumber) {
            try {
                $results[] = $this->cnamService->lookup($phoneNumber);
            } catch (\InvalidArgumentException $e) {
                // Collect validation errors without stopping batch
                $errors[] = [
                    'phone_number' => $phoneNumber,
                    'error' => $e->getMessage(),
                ];
            }
        }

        return response()->json([
            'results' => $results,
            'errors' => $errors,
            'total_processed' => count($results),
            'total_errors' => count($errors),
        ], 200);
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\CnamLookupController;
use Illuminate\Support\Facades\Route;

Route::post('/cnam/lookup', [CnamLookupController::class, 'lookup']);
Route::post('/cnam/batch-lookup', [CnamLookupController::class, 'batchLookup']);
```

Create a global exception handler to catch Telnyx API errors. Edit `app/Exceptions/Handler.php`:

```php
<?php

namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Illuminate\Http\JsonResponse;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;
use Throwable;

class Handler extends ExceptionHandler
{
    /**
     * Register exception handling callbacks.
     */
    public function register(): void
    {
        $this->reportable(function (Throwable $e) {
            //
        });
    }

    /**
     * Render an exception into an HTTP response.
     */
    public function render($request, Throwable $exception): JsonResponse
    {
        // Handle Telnyx authentication errors
        if ($exception instanceof AuthenticationException) {
            return response()->json([
                'error' => 'Invalid API key or authentication failed',
                'status' => 401,
            ], 401);
        }

        // Handle Telnyx rate limit errors
        if ($exception instanceof RateLimitException) {
            return response()->json([
                'error' => 'Rate limit exceeded. Please slow down.',
                'status' => 429,
            ], 429);
        }

        // Handle general Telnyx API errors
        if ($exception instanceof ApiException) {
            $statusCode = $exception->getHttpStatus() ?? 500;
            return response()->json([
                'error' => $exception->getMessage(),
                'status' => $statusCode,
            ], $statusCode);
        }

        // Fall back to parent handler for other exceptions
        return parent::render($request, $exception);
    }
}
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-cnam-lookup-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key or authentication failed"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Laravel development server with `php artisan serve` after updating the `.env` file. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" when submitting a lookup request. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl request to use properly formatted numbers. |
| CNAM Lookup Not Found | The endpoint returns `"lookup_status": "not_found"` with `"caller_name": null` for valid phone numbers. | This is expected behavior for numbers where CNAM data is not available in the database. Not all phone numbers have associated caller name information. The lookup was successful; the data simply does not exist. Check the `carrier_name` and `phone_type` fields which may still contain useful information. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | You have exceeded the Telnyx API rate limit. Implement exponential backoff in your batch lookup logic and add delays between requests. For batch operations, consider processing phone numbers in smaller chunks with pauses between batches. Check your Telnyx Portal for current rate limit settings. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What PHP version do I need?**

PHP 8.1 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [SIP Configuration Guides](https://developers.telnyx.com/docs/voice/sip-trunking/configuration-guides)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)

## Related Examples

- [Set Up SIP Trunking with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/php/sip-trunking-setup).
- [Configure SIP Authentication](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/php/sip-authentication).
- [Route Inbound SIP Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/php/inbound-sip-routing).
