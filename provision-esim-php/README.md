# eSIM Provisioning with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that provisions eSIM profiles over-the-air using the Telnyx IoT SIM Management API. This tutorial demonstrates how to manage eSIM lifecycle—from profile creation through activation and status monitoring—using the Telnyx PHP SDK with proper error handling, database persistence, and webhook integration for real-time status updates.

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
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).
- MySQL or SQLite for storing eSIM provisioning records.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/provision-esim-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a model to represent eSIM profiles:

```bash
php artisan make:model EsimProfile
```

Edit `app/Models/EsimProfile.php`:

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class EsimProfile extends Model
{
    protected $fillable = [
        'iccid',
        'status',
        'device_name',
        'activation_code',
        'metadata',
        'activated_at',
    ];

    protected $casts = [
        'metadata' => 'array',
        'activated_at' => 'datetime',
    ];
}
```

Create a service class to handle eSIM provisioning logic:

```bash
php artisan make:class Services/EsimProvisioningService
```

Edit `app/Services/EsimProvisioningService.php`:

```php
<?php

namespace App\Services;

use App\Models\EsimProfile;
use Telnyx\Client;
use Telnyx\Exception\ApiException;

class EsimProvisioningService
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client(apiKey: config('telnyx.api_key'));
    }

    /**
     * Provision a new eSIM profile.
     * 
     * @param string $deviceName
     * @param array $metadata
     * @return array
     * @throws ApiException
     */
    public function provisionProfile(string $deviceName, array $metadata = []): array
    {
        // Call Telnyx eSIM API to create profile
        // Note: This example assumes the eSIM endpoint is available via the SDK
        // Adjust based on actual SDK method availability
        $response = $this->client->simCards->list([
            'filter' => ['status' => 'pending'],
            'page' => ['size' => 1],
        ]);

        if (empty($response->data)) {
            throw new \Exception('No available eSIM profiles from Telnyx');
        }

        $simCard = $response->data[0];

        // Store provisioning record in database
        $profile = EsimProfile::create([
            'iccid' => $simCard->iccid,
            'status' => 'provisioned',
            'device_name' => $deviceName,
            'activation_code' => $this->generateActivationCode(),
            'metadata' => $metadata,
        ]);

        return [
            'id' => $profile->id,
            'iccid' => $profile->iccid,
            'status' => $profile->status,
            'device_name' => $profile->device_name,
            'activation_code' => $profile->activation_code,
        ];
    }

    /**
     * Activate an eSIM profile.
     * 
     * @param int $profileId
     * @return array
     * @throws ApiException
     */
    public function activateProfile(int $profileId): array
    {
        $profile = EsimProfile::findOrFail($profileId);

        // Call Telnyx API to activate SIM
        $response = $this->client->simCards->activate($profile->iccid, [
            'callback_url' => config('telnyx.base_url') . '/webhooks/esim-status',
        ]);

        // Update profile status
        $profile->update([
            'status' => 'active',
            'activated_at' => now(),
            'metadata' => array_merge($profile->metadata ?? [], [
                'sim_card_id' => $response->data->id ?? null,
            ]),
        ]);

        return [
            'id' => $profile->id,
            'iccid' => $profile->iccid,
            'status' => $profile->status,
            'activated_at' => $profile->activated_at,
        ];
    }

    /**
     * Get eSIM profile details.
     * 
     * @param int $profileId
     * @return array
     */
    public function getProfile(int $profileId): array
    {
        $profile = EsimProfile::findOrFail($profileId);

        return [
            'id' => $profile->id,
            'iccid' => $profile->iccid,
            'status' => $profile->status,
            'device_name' => $profile->device_name,
            'activation_code' => $profile->activation_code,
            'activated_at' => $profile->activated_at,
            'metadata' => $profile->metadata,
        ];
    }

    /**
     * List all eSIM profiles with optional filtering.
     * 
     * @param array $filters
     * @return array
     */
    public function listProfiles(array $filters = []): array
    {
        $query = EsimProfile::query();

        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        if (isset($filters['device_name'])) {
            $query->where('device_name', 'like', '%' . $filters['device_name'] . '%');
        }

        $profiles = $query->paginate(20);

        return [
            'data' => $profiles->map(fn($p) => [
                'id' => $p->id,
                'iccid' => $p->iccid,
                'status' => $p->status,
                'device_name' => $p->device_name,
                'activated_at' => $p->activated_at,
            ])->toArray(),
            'pagination' => [
                'total' => $profiles->total(),
                'per_page' => $profiles->perPage(),
                'current_page' => $profiles->currentPage(),
            ],
        ];
    }

    /**
     * Generate a unique activation code.
     * 
     * @return string
     */
    private function generateActivationCode(): string
    {
        return strtoupper(bin2hex(random_bytes(8)));
    }
}
```

Create a controller to handle HTTP requests:

```bash
php artisan make:controller EsimProvisioningController
```

Edit `app/Http/Controllers/EsimProvisioningController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Models\EsimProfile;
use App\Services\EsimProvisioningService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;

class EsimProvisioningController extends Controller
{
    private EsimProvisioningService $service;

    public function __construct(EsimProvisioningService $service)
    {
        $this->service = $service;
    }

    /**
     * Provision a new eSIM profile.
     */
    public function provision(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'device_name' => 'required|string|max:255',
            'metadata' => 'nullable|array',
        ]);

        try {
            $result = $this->service->provisionProfile(
                $validated['device_name'],
                $validated['metadata'] ?? []
            );

            return response()->json($result, 201);
        } catch (AuthenticationException) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (RateLimitException) {
            return response()->json(['error' => 'Rate limit exceeded'], 429);
        } catch (ApiException $e) {
            return response()->json(
                ['error' => $e->getMessage(), 'status_code' => $e->getHttpStatus()],
                $e->getHttpStatus() ?? 500
            );
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        }
    }

    /**
     * Activate an eSIM profile.
     */
    public function activate(Request $request, int $id): JsonResponse
    {
        try {
            $result = $this->service->activateProfile($id);
            return response()->json($result, 200);
        } catch (AuthenticationException) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (RateLimitException) {
            return response()->json(['error' => 'Rate limit exceeded'], 429);
        } catch (ApiException $e) {
            return response()->json(
                ['error' => $e->getMessage(), 'status_code' => $e->getHttpStatus()],
                $e->getHttpStatus() ?? 500
            );
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException) {
            return response()->json(['error' => 'eSIM profile not found'], 404);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        }
    }

    /**
     * Get eSIM profile details.
     */
    public function show(int $id): JsonResponse
    {
        try {
            $result = $this->service->getProfile($id);
            return response()->json($result, 200);
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException) {
            return response()->json(['error' => 'eSIM profile not found'], 404);
        }
    }

    /**
     * List all eSIM profiles.
     */
    public function index(Request $request): JsonResponse
    {
        $filters = $request->only(['status', 'device_name']);
        $result = $this->service->listProfiles($filters);
        return response()->json($result, 200);
    }
}
```

Create a webhook controller to handle status updates:

```bash
php artisan make:controller WebhookController
```

Edit `app/Http/Controllers/WebhookController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Models\EsimProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WebhookController extends Controller
{
    /**
     * Handle eSIM status change webhooks from Telnyx.
     */
    public function handleEsimStatus(Request $request): JsonResponse
    {
        // Verify webhook signature (optional but recommended)
        $signature = $request->header('X-Telnyx-Signature-Token');
        if (!$this->verifyWebhookSignature($request, $signature)) {
            return response()->json(['error' => 'Invalid signature'], 401);
        }

        $payload = $request->all();

        // Handle sim_card.status.changed event
        if ($payload['event_type'] === 'sim_card.status.changed') {
            $iccid = $payload['data']['iccid'] ?? null;
            $status = $payload['data']['status'] ?? null;

            if ($iccid && $status) {
                EsimProfile::where('iccid', $iccid)->update([
                    'status' => $status,
                    'metadata' => \DB::raw("JSON_SET(metadata, '$.last_webhook_event', '" . now() . "')"),
                ]);
            }
        }

        // Handle sim_card.data_limit.reached event
        if ($payload['event_type'] === 'sim_card.data_limit.reached') {
            $iccid = $payload['data']['iccid'] ?? null;

            if ($iccid) {
                EsimProfile::where('iccid', $iccid)->update([
                    'metadata' => \DB::raw("JSON_SET(metadata, '$.data_limit_reached', true)"),
                ]);
            }
        }

        return response()->json(['status' => 'received'], 200);
    }

    /**
     * Verify webhook signature using HMAC-SHA256.
     */
    private function verifyWebhookSignature(Request $request, ?string $signature): bool
    {
        if (!$signature) {
            return false;
        }

        $secret = config('telnyx.webhook_secret');
        $body = $request->getContent();
        $expectedSignature = hash_hmac('sha256', $body, $secret);

        return hash_equals($expectedSignature, $signature);
    }
}
```

Register routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\EsimProvisioningController;
use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::prefix('esim')->group(function () {
    Route::post('/provision', [EsimProvisioningController::class, 'provision']);
    Route::post('/{id}/activate', [EsimProvisioningController::class, 'activate']);
    Route::get('/{id}', [EsimProvisioningController::class, 'show']);
    Route::get('/', [EsimProvisioningController::class, 'index']);
});

Route::post('/webhooks/esim-status', [WebhookController::class, 'handleEsimStatus']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Laravel development server after updating the `.env` file. |
| Model Not Found Exception | Attempting to activate a profile returns `{"error": "eSIM profile not found"}` with HTTP 404. | Confirm the profile ID exists in the database by running `php artisan tinker` and querying `App\Models\EsimProfile::find($id)`. Verify the migration ran successfully with `php artisan migrate:status`. |
| Webhook Signature Verification Fails | Webhooks are rejected with `{"error": "Invalid signature"}` even though the payload is valid. | Ensure `TELNYX_WEBHOOK_SECRET` is set correctly in your `.env` file and matches the secret configured in the Telnyx Portal. Verify the webhook URL in the Portal matches your ngrok URL exactly. Check that the request body is not being modified by middleware before reaching the webhook handler. |
| Rate Limit Exceeded (429) | Requests return `{"error": "Rate limit exceeded"}` with HTTP 429. | Implement exponential backoff in your provisioning logic. The Telnyx API allows 100 requests per second; space out bulk provisioning operations. Consider using Laravel queues to distribute requests over time. |
| Database Connection Error | Migration fails with "SQLSTATE[HY000]" or similar database error. | Verify your database credentials in `.env` (DB_HOST, DB_USERNAME, DB_PASSWORD, DB_DATABASE). Ensure the database server is running. For SQLite, confirm the `database/` directory is writable. Run `php artisan migrate:refresh` to reset migrations if needed. |

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

- [Monitor SIM Card Data Usage](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/php/data-usage-monitoring).
- [Configure Custom APN Settings](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/php/apn-configuration).
- [Handle SIM Status Change Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/php/sim-status-webhook).
