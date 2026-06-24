# Device Location with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that tracks device locations using Telnyx IoT SIM cards. This tutorial demonstrates how to query SIM card network attachment data, process location information from carrier networks, and store device locations in a database. You'll learn to handle asynchronous location updates via webhooks, implement proper error handling for telecom APIs, and display real-time device positions on a map.

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
- Active Telnyx IoT SIM cards with network connectivity.
- A publicly accessible URL for webhook testing (ngrok or similar).
- SQLite or MySQL for storing location data.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/track-iot-device-location-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle Telnyx IoT operations. Generate it with:

```bash
php artisan make:class Services/TelnyxIoTService
```

Edit `app/Services/TelnyxIoTService.php`:

```php
<?php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\TelnyxException;

class TelnyxIoTService
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client(apiKey: config('telnyx.api_key'));
    }

    /**
     * Retrieve all SIM cards with their current network status.
     * Returns array of SIM card data suitable for JSON serialization.
     */
    public function listSimCards(array $params = []): array
    {
        try {
            $response = $this->client->simCards->list($params);
            
            // Extract serializable data — SDK objects are NOT JSON-serializable
            return array_map(function ($sim) {
                return [
                    'id' => $sim->id,
                    'iccid' => $sim->iccid,
                    'status' => $sim->status,
                    'sim_card_group_id' => $sim->sim_card_group_id ?? null,
                    'type' => $sim->type ?? null,
                ];
            }, $response->data ?? []);
        } catch (TelnyxException $e) {
            throw $e;
        }
    }

    /**
     * Get detailed information for a specific SIM card.
     * Includes network attachment status and carrier information.
     */
    public function getSimCard(string $simCardId): array
    {
        try {
            $response = $this->client->simCards->retrieve($simCardId);
            
            return [
                'id' => $response->data->id,
                'iccid' => $response->data->iccid,
                'status' => $response->data->status,
                'sim_card_group_id' => $response->data->sim_card_group_id ?? null,
                'type' => $response->data->type ?? null,
                'phone_number' => $response->data->phone_number ?? null,
            ];
        } catch (TelnyxException $e) {
            throw $e;
        }
    }

    /**
     * Activate a SIM card to enable network connectivity.
     * Required before a device can attach to the network.
     */
    public function activateSimCard(string $simCardId): array
    {
        try {
            $response = $this->client->simCards->activate($simCardId);
            
            return [
                'id' => $response->data->id,
                'status' => $response->data->status,
                'iccid' => $response->data->iccid,
            ];
        } catch (TelnyxException $e) {
            throw $e;
        }
    }

    /**
     * Get network usage data for a SIM card.
     * Useful for monitoring data consumption and device activity.
     */
    public function getNetworkUsage(string $simCardId): array
    {
        try {
            // Network usage requires direct REST call via the SDK's HTTP client
            $response = $this->client->request(
                'GET',
                "/v2/sim_cards/{$simCardId}/network_usage"
            );
            
            return $response->json() ?? [];
        } catch (TelnyxException $e) {
            throw $e;
        }
    }
}
```

Create a model for storing device locations:

```bash
php artisan make:model DeviceLocation
```

Edit `app/Models/DeviceLocation.php`:

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DeviceLocation extends Model
{
    protected $fillable = [
        'sim_card_id',
        'iccid',
        'latitude',
        'longitude',
        'carrier',
        'network_status',
        'last_seen_at',
    ];

    protected $casts = [
        'latitude' => 'float',
        'longitude' => 'float',
        'last_seen_at' => 'datetime',
    ];

    /**
     * Scope to get the most recent location for each SIM card.
     */
    public function scopeLatestPerSim($query)
    {
        return $query->whereIn('id', function ($subQuery) {
            $subQuery->selectRaw('MAX(id)')
                ->from('device_locations')
                ->groupBy('sim_card_id');
        });
    }
}
```

Create a controller to handle location queries and webhooks:

```bash
php artisan make:controller DeviceLocationController
```

Edit `app/Http/Controllers/DeviceLocationController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Models\DeviceLocation;
use App\Services\TelnyxIoTService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;
use Telnyx\Exception\TelnyxException;

class DeviceLocationController extends Controller
{
    private TelnyxIoTService $telnyxService;

    public function __construct(TelnyxIoTService $telnyxService)
    {
        $this->telnyxService = $telnyxService;
    }

    /**
     * List all SIM cards and their latest known locations.
     */
    public function listDevices(): JsonResponse
    {
        try {
            $simCards = $this->telnyxService->listSimCards();
            
            // Enrich SIM card data with latest location information
            $devices = array_map(function ($sim) {
                $location = DeviceLocation::where('sim_card_id', $sim['id'])
                    ->latest('last_seen_at')
                    ->first();
                
                return [
                    'sim_card_id' => $sim['id'],
                    'iccid' => $sim['iccid'],
                    'status' => $sim['status'],
                    'location' => $location ? [
                        'latitude' => $location->latitude,
                        'longitude' => $location->longitude,
                        'carrier' => $location->carrier,
                        'network_status' => $location->network_status,
                        'last_seen_at' => $location->last_seen_at?->toIso8601String(),
                    ] : null,
                ];
            }, $simCards);
            
            return response()->json(['devices' => $devices], 200);
        } catch (AuthenticationException) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (RateLimitException) {
            return response()->json(['error' => 'Rate limit exceeded'], 429);
        } catch (TelnyxException $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Get detailed location history for a specific SIM card.
     */
    public function getDeviceHistory(string $simCardId): JsonResponse
    {
        try {
            $locations = DeviceLocation::where('sim_card_id', $simCardId)
                ->orderBy('last_seen_at', 'desc')
                ->limit(50)
                ->get()
                ->map(function ($location) {
                    return [
                        'latitude' => $location->latitude,
                        'longitude' => $location->longitude,
                        'carrier' => $location->carrier,
                        'network_status' => $location->network_status,
                        'last_seen_at' => $location->last_seen_at?->toIso8601String(),
                    ];
                });
            
            return response()->json([
                'sim_card_id' => $simCardId,
                'location_history' => $locations,
            ], 200);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Webhook endpoint to receive SIM card network attachment events.
     * Telnyx sends sim_card.network.attached events when a device connects.
     */
    public function handleNetworkWebhook(Request $request): JsonResponse
    {
        try {
            $payload = $request->json()->all();
            
            // Verify webhook signature for security
            if (!$this->verifyWebhookSignature($request)) {
                return response()->json(['error' => 'Invalid signature'], 401);
            }
            
            $eventType = $payload['data']['event_type'] ?? null;
            $simCardId = $payload['data']['sim_card_id'] ?? null;
            
            if ($eventType === 'sim_card.network.attached' && $simCardId) {
                // Extract location data from webhook payload
                // Note: Telnyx provides carrier and network info; actual GPS requires device reporting
                $locationData = [
                    'sim_card_id' => $simCardId,
                    'iccid' => $payload['data']['iccid'] ?? null,
                    'carrier' => $payload['data']['carrier'] ?? null,
                    'network_status' => 'attached',
                    'last_seen_at' => now(),
                ];
                
                // Store or update location record
                DeviceLocation::updateOrCreate(
                    ['sim_card_id' => $simCardId],
                    $locationData
                );
            }
            
            return response()->json(['status' => 'received'], 200);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Activate a SIM card to enable location tracking.
     */
    public function activateDevice(string $simCardId): JsonResponse
    {
        try {
            $result = $this->telnyxService->activateSimCard($simCardId);
            
            return response()->json([
                'message' => 'SIM card activated successfully',
                'sim_card' => $result,
            ], 200);
        } catch (AuthenticationException) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (RateLimitException) {
            return response()->json(['error' => 'Rate limit exceeded'], 429);
        } catch (TelnyxException $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Verify webhook signature using HMAC-SHA256.
     * Ensures the webhook came from Telnyx.
     */
    private function verifyWebhookSignature(Request $request): bool
    {
        $signature = $request->header('X-Telnyx-Signature-Token');
        $secret = config('telnyx.webhook_secret');
        
        if (!$signature || !$secret) {
            return false;
        }
        
        $body = $request->getContent();
        $expectedSignature = hash_hmac('sha256', $body, $secret);
        
        return hash_equals($expectedSignature, $signature);
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\DeviceLocationController;
use Illuminate\Support\Facades\Route;

Route::prefix('devices')->group(function () {
    Route::get('/', [DeviceLocationController::class, 'listDevices']);
    Route::get('/{simCardId}/history', [DeviceLocationController::class, 'getDeviceHistory']);
    Route::post('/{simCardId}/activate', [DeviceLocationController::class, 'activateDevice']);
});

Route::post('/webhooks/network', [DeviceLocationController::class, 'handleNetworkWebhook']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/track-iot-device-location-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Laravel development server with `php artisan serve` after updating the `.env` file. |
| Webhook Not Receiving Events | The webhook endpoint is registered but no events are being delivered. | Confirm the webhook URL in the Telnyx Portal is set to your ngrok URL (e.g., `https://your-ngrok-url.ngrok.io/api/webhooks/network`). Verify the `TELNYX_WEBHOOK_SECRET` is set in your `.env` file and matches the secret in the Portal. Check ngrok logs to see if requests are arriving. Ensure your SIM cards are active and have network connectivity. |
| Location Data Always Null | Devices are listed but the `location` field is always null. | Location data is populated when the `sim_card.network.attached` webhook event is received. Ensure your SIM cards are activated and have connected to the network. Check the `device_locations` table in your database to verify records are being created. You can manually insert test data: `php artisan tinker` then `DeviceLocation::create(['sim_card_id' => 'test-id', 'latitude' => 40.7128, 'longitude' => -74.0060, 'carrier' => 'Verizon', 'network_status' => 'attached', 'last_seen_at' => now()])`. |
| Rate Limit Errors (429) | Requests return `{"error": "Rate limit exceeded"}` with HTTP 429. | Telnyx API has rate limits. Implement exponential backoff in your client code. Cache SIM card lists for 5–10 minutes instead of querying on every request. Use Laravel's cache: `Cache::remember('sim_cards', 600, fn() => $this->telnyxService->listSimCards())`. |
| Database Migration Fails | Running `php artisan migrate` returns an error about the migration file. | Ensure the migration file is in `database/migrations/` with the correct naming convention (timestamp_create_device_locations_table.php). Check that your database connection is configured correctly in `.env` (e.g., `DB_CONNECTION=sqlite` or `DB_CONNECTION=mysql`). Run `php artisan migrate:fresh` to reset and re-run all migrations. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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

- [Activate SIM Cards with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/php/sim-activation).
- [Monitor Data Usage with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/php/data-usage-monitoring).
- [Handle SIM Status Webhooks with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/php/sim-status-webhook).
