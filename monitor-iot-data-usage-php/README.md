# Data Usage Monitoring with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that monitors SIM card data usage in real time using the Telnyx IoT API. This tutorial demonstrates how to retrieve data consumption metrics, set up alerts when SIMs approach their data limits, and handle webhook events for proactive monitoring. You'll learn the new PHP SDK client initialization pattern, proper error handling for telecom APIs, and secure credential management via environment variables.

## Who Is This For?

- **PHP developers** building iot features with Laravel.
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
- At least one active SIM card in your Telnyx account.
- A publicly accessible URL for webhook testing (ngrok or similar).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to encapsulate Telnyx API interactions. Generate a new service:

```bash
php artisan make:service TelnyxSimService
```

Edit `app/Services/TelnyxSimService.php`:

```php
<?php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiErrorException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;

class TelnyxSimService
{
    private Client $client;

    public function __construct()
    {
        // Initialize client with the new SDK pattern
        $this->client = new Client(apiKey: env('TELNYX_API_KEY'));
    }

    /**
     * Retrieve all SIM cards with pagination support.
     *
     * @param int $limit Number of results per page.
     * @param string|null $after Cursor for pagination.
     * @return array JSON-serializable SIM card list.
     */
    public function listSimCards(int $limit = 20, ?string $after = null): array
    {
        $params = ['limit' => $limit];
        if ($after) {
            $params['after'] = $after;
        }

        $response = $this->client->simCards->list($params);

        // Extract serializable data — SDK objects are NOT JSON-serializable
        return array_map(fn($sim) => [
            'id' => $sim->id,
            'iccid' => $sim->iccid,
            'status' => $sim->status,
            'sim_card_group_id' => $sim->sim_card_group_id ?? null,
        ], $response->data);
    }

    /**
     * Retrieve a single SIM card by ID.
     *
     * @param string $simCardId The SIM card ID.
     * @return array JSON-serializable SIM card data.
     */
    public function getSimCard(string $simCardId): array
    {
        $response = $this->client->simCards->retrieve($simCardId);

        return [
            'id' => $response->data->id,
            'iccid' => $response->data->iccid,
            'status' => $response->data->status,
            'sim_card_group_id' => $response->data->sim_card_group_id ?? null,
            'phone_number' => $response->data->phone_number ?? null,
        ];
    }

    /**
     * Get data usage for a specific SIM card.
     * Note: Data usage is reported asynchronously; poll periodically or use webhooks.
     *
     * @param string $simCardId The SIM card ID.
     * @return array Data usage metrics.
     */
    public function getDataUsage(string $simCardId): array
    {
        // Construct the REST endpoint directly since SDK may not expose network_usage
        $url = "https://api.telnyx.com/v2/sim_cards/{$simCardId}/network_usage";
        
        $response = $this->makeRawRequest('GET', $url);

        if (!isset($response['data'])) {
            return [
                'sim_card_id' => $simCardId,
                'usage_mb' => 0,
                'limit_mb' => null,
                'percentage_used' => 0,
            ];
        }

        $data = $response['data'];
        $usageMb = $data['usage_mb'] ?? 0;
        $limitMb = $data['limit_mb'] ?? null;
        $percentageUsed = $limitMb ? round(($usageMb / $limitMb) * 100, 2) : 0;

        return [
            'sim_card_id' => $simCardId,
            'usage_mb' => $usageMb,
            'limit_mb' => $limitMb,
            'percentage_used' => $percentageUsed,
            'last_updated' => $data['last_updated_at'] ?? null,
        ];
    }

    /**
     * Check if a SIM card has exceeded the configured data threshold.
     *
     * @param string $simCardId The SIM card ID.
     * @return bool True if usage exceeds threshold.
     */
    public function isDataUsageExceeded(string $simCardId): bool
    {
        $usage = $this->getDataUsage($simCardId);
        $threshold = config('services.telnyx.data_threshold', 80);

        return $usage['percentage_used'] >= $threshold;
    }

    /**
     * Make a raw HTTP request to Telnyx API.
     * Used for endpoints not yet exposed by the SDK.
     *
     * @param string $method HTTP method (GET, POST, etc.).
     * @param string $url Full API endpoint URL.
     * @param array $data Request body (for POST/PUT).
     * @return array Decoded JSON response.
     */
    private function makeRawRequest(string $method, string $url, array $data = []): array
    {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Authorization: Bearer ' . env('TELNYX_API_KEY'),
            'Content-Type: application/json',
        ]);

        if (!empty($data)) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        }

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode >= 400) {
            throw new ApiErrorException("HTTP {$httpCode}: {$response}");
        }

        return json_decode($response, true) ?? [];
    }
}
```

Create a controller to handle data usage monitoring endpoints:

```bash
php artisan make:controller SimDataController
```

Edit `app/Http/Controllers/SimDataController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\TelnyxSimService;
use Telnyx\Exception\ApiErrorException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;
use Illuminate\Http\JsonResponse;

class SimDataController extends Controller
{
    private TelnyxSimService $simService;

    public function __construct(TelnyxSimService $simService)
    {
        $this->simService = $simService;
    }

    /**
     * List all SIM cards with pagination.
     */
    public function listSims(): JsonResponse
    {
        try {
            $sims = $this->simService->listSimCards();
            return response()->json(['data' => $sims], 200);
        } catch (AuthenticationException) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (RateLimitException) {
            return response()->json(['error' => 'Rate limit exceeded'], 429);
        } catch (ApiErrorException $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Get data usage for a specific SIM card.
     */
    public function getDataUsage(string $simCardId): JsonResponse
    {
        try {
            $usage = $this->simService->getDataUsage($simCardId);
            return response()->json($usage, 200);
        } catch (AuthenticationException) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (RateLimitException) {
            return response()->json(['error' => 'Rate limit exceeded'], 429);
        } catch (ApiErrorException $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Check if a SIM card has exceeded the data threshold.
     */
    public function checkDataThreshold(string $simCardId): JsonResponse
    {
        try {
            $exceeded = $this->simService->isDataUsageExceeded($simCardId);
            $usage = $this->simService->getDataUsage($simCardId);

            return response()->json([
                'sim_card_id' => $simCardId,
                'threshold_exceeded' => $exceeded,
                'usage' => $usage,
            ], 200);
        } catch (AuthenticationException) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (RateLimitException) {
            return response()->json(['error' => 'Rate limit exceeded'], 429);
        } catch (ApiErrorException $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Handle incoming webhook events from Telnyx.
     * Triggered on sim_card.data_limit.reached and sim_card.status.changed events.
     */
    public function handleWebhook(): JsonResponse
    {
        $payload = request()->getContent();
        $signature = request()->header('Telnyx-Signature-ED25519');
        $timestamp = request()->header('Telnyx-Timestamp');

        // Verify webhook signature for security
        if (!$this->verifyWebhookSignature($payload, $signature, $timestamp)) {
            return response()->json(['error' => 'Invalid signature'], 401);
        }

        $event = json_decode($payload, true);

        // Handle data limit reached event
        if ($event['data']['event_type'] === 'sim_card.data_limit.reached') {
            $simCardId = $event['data']['sim_card_id'];
            \Log::warning("Data limit reached for SIM: {$simCardId}");
            // Implement custom logic: send alert, suspend SIM, etc.
        }

        // Handle SIM status change event
        if ($event['data']['event_type'] === 'sim_card.status.changed') {
            $simCardId = $event['data']['sim_card_id'];
            $newStatus = $event['data']['status'];
            \Log::info("SIM {$simCardId} status changed to: {$newStatus}");
        }

        return response()->json(['status' => 'received'], 200);
    }

    /**
     * Verify webhook signature using ED25519.
     */
    private function verifyWebhookSignature(string $payload, ?string $signature, ?string $timestamp): bool
    {
        if (!$signature || !$timestamp) {
            return false;
        }

        $secret = env('TELNYX_WEBHOOK_SECRET');
        if (!$secret) {
            return false;
        }

        // Reconstruct signed content: timestamp.payload
        $signedContent = "{$timestamp}.{$payload}";

        // Verify ED25519 signature (requires libsodium)
        try {
            $publicKey = sodium_hex2bin(substr($secret, 0, 64));
            $signatureBinary = sodium_hex2bin($signature);

            return sodium_crypto_sign_open(
                $signatureBinary . $signedContent,
                $publicKey
            ) !== false;
        } catch (\Exception $e) {
            \Log::error("Webhook signature verification failed: {$e->getMessage()}");
            return false;
        }
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\SimDataController;
use Illuminate\Support\Facades\Route;

Route::prefix('sims')->group(function () {
    Route::get('/', [SimDataController::class, 'listSims']);
    Route::get('/{simCardId}/data-usage', [SimDataController::class, 'getDataUsage']);
    Route::get('/{simCardId}/check-threshold', [SimDataController::class, 'checkDataThreshold']);
});

Route::post('/webhooks/telnyx', [SimDataController::class, 'handleWebhook']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Laravel server with `php artisan serve`. |
| Data Usage Returns Zero | The `/data-usage` endpoint returns `usage_mb: 0` and `limit_mb: null` even though the SIM is active. | Data usage is reported asynchronously by Telnyx and may take several minutes to appear after device activity. Verify the SIM card ID is correct by calling `/api/sims` first. If the SIM has no recent network activity, usage will remain zero. Check the Telnyx Portal to confirm the SIM is actively connected to a network. |
| Webhook Signature Verification Fails | The webhook handler returns `{"error": "Invalid signature"}` when testing with curl. | Webhook signatures require the exact payload and timestamp from Telnyx. When testing locally, use ngrok to expose your server and configure the webhook URL in the Telnyx Portal. For manual testing, you can temporarily disable signature verification by returning `true` in `verifyWebhookSignature()`, but always re-enable it in production. Ensure `TELNYX_WEBHOOK_SECRET` is set in your `.env` file. |
| Rate Limit Error (429) | Requests return `{"error": "Rate limit exceeded"}` after multiple API calls. | Telnyx enforces rate limits on API requests. Implement exponential backoff in your polling logic: wait 1 second, then 2 seconds, then 4 seconds between retries. For production monitoring, use webhooks instead of polling to avoid hitting rate limits. Cache data usage results for at least 60 seconds before making another API call. |
| SIM Card ID Not Found | The endpoint returns a 500 error when querying a non-existent SIM card ID. | Verify the SIM card ID format: it should start with `sim_` followed by alphanumeric characters. Retrieve the correct ID by calling `/api/sims` to list all available SIM cards. Ensure the SIM card belongs to your Telnyx account and has not been deleted. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What PHP version do I need?**

PHP 8.1 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [SIM Card API Reference](https://developers.telnyx.com/api-reference/sim-cards/get-all-sim-cards)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)

## Related Examples

- [Activate SIM Cards Programmatically](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/php/sim-activation).
- [Monitor SIM Status Changes with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/php/sim-status-webhook).
- [Configure Custom APN Settings](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/php/apn-configuration).
