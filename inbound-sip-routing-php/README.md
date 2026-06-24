# Inbound SIP Routing with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that receives inbound SIP calls and routes them to your SIP endpoints using the Telnyx SIP Trunking API. This tutorial demonstrates how to create a SIP connection, configure inbound routing, and handle webhook notifications for call events using Laravel's routing and middleware patterns.

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
- A Telnyx phone number assigned to your SIP connection.
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).
- A SIP endpoint (PBX, softphone, or SBC) to receive inbound calls.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to manage SIP connections. Generate it using Artisan:

```bash
php artisan make:service SipConnectionService
```

Edit `app/Services/SipConnectionService.php`:

```php
<?php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;

class SipConnectionService
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client(apiKey: env('TELNYX_API_KEY'));
    }

    /**
     * Create a new SIP connection for inbound routing.
     * 
     * @param string $name Connection name
     * @param string $username SIP username for credential authentication
     * @param string $password SIP password
     * @return array JSON-serializable connection data
     */
    public function createConnection(string $name, string $username, string $password): array
    {
        $response = $this->client->sipConnections->create([
            'connection_name' => $name,
            'connection_type' => 'credential',
            'credentials' => [
                'sip_username' => $username,
                'sip_password' => $password,
            ],
            'inbound' => [
                'channel_limit' => 10,
                'sip_subdomain' => strtolower(str_replace(' ', '-', $name)),
            ],
        ]);

        return [
            'id' => $response->data->id,
            'name' => $response->data->connection_name,
            'username' => $response->data->credentials->sip_username ?? null,
            'sip_subdomain' => $response->data->inbound->sip_subdomain ?? null,
        ];
    }

    /**
     * List all SIP connections.
     * 
     * @return array List of connections with serializable data
     */
    public function listConnections(): array
    {
        $response = $this->client->sipConnections->list();

        return array_map(fn($connection) => [
            'id' => $connection->id,
            'name' => $connection->connection_name,
            'type' => $connection->connection_type,
            'sip_subdomain' => $connection->inbound->sip_subdomain ?? null,
        ], $response->data);
    }

    /**
     * Retrieve a specific SIP connection by ID.
     * 
     * @param string $connectionId
     * @return array Connection details
     */
    public function getConnection(string $connectionId): array
    {
        $response = $this->client->sipConnections->retrieve($connectionId);

        return [
            'id' => $response->data->id,
            'name' => $response->data->connection_name,
            'type' => $response->data->connection_type,
            'username' => $response->data->credentials->sip_username ?? null,
            'sip_subdomain' => $response->data->inbound->sip_subdomain ?? null,
            'channel_limit' => $response->data->inbound->channel_limit ?? null,
        ];
    }

    /**
     * Update SIP connection inbound settings.
     * 
     * @param string $connectionId
     * @param array $settings Inbound routing settings
     * @return array Updated connection data
     */
    public function updateInboundSettings(string $connectionId, array $settings): array
    {
        $response = $this->client->sipConnections->update($connectionId, [
            'inbound' => $settings,
        ]);

        return [
            'id' => $response->data->id,
            'name' => $response->data->connection_name,
            'inbound' => [
                'channel_limit' => $response->data->inbound->channel_limit ?? null,
                'sip_subdomain' => $response->data->inbound->sip_subdomain ?? null,
            ],
        ];
    }
}
```

Create a controller to handle SIP connection management:

```bash
php artisan make:controller SipConnectionController
```

Edit `app/Http/Controllers/SipConnectionController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\SipConnectionService;
use Telnyx\Exception\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SipConnectionController extends Controller
{
    private SipConnectionService $sipService;

    public function __construct(SipConnectionService $sipService)
    {
        $this->sipService = $sipService;
    }

    /**
     * Create a new SIP connection.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'username' => 'required|string|max:255',
            'password' => 'required|string|min:8',
        ]);

        try {
            $connection = $this->sipService->createConnection(
                $validated['name'],
                $validated['username'],
                $validated['password']
            );

            return response()->json($connection, 201);
        } catch (ApiException $e) {
            return response()->json([
                'error' => $e->getMessage(),
                'status_code' => $e->getHttpStatus(),
            ], $e->getHttpStatus());
        }
    }

    /**
     * List all SIP connections.
     */
    public function index(): JsonResponse
    {
        try {
            $connections = $this->sipService->listConnections();
            return response()->json($connections);
        } catch (ApiException $e) {
            return response()->json([
                'error' => $e->getMessage(),
                'status_code' => $e->getHttpStatus(),
            ], $e->getHttpStatus());
        }
    }

    /**
     * Get a specific SIP connection.
     */
    public function show(string $id): JsonResponse
    {
        try {
            $connection = $this->sipService->getConnection($id);
            return response()->json($connection);
        } catch (ApiException $e) {
            return response()->json([
                'error' => $e->getMessage(),
                'status_code' => $e->getHttpStatus(),
            ], $e->getHttpStatus());
        }
    }

    /**
     * Update SIP connection inbound settings.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        $validated = $request->validate([
            'channel_limit' => 'integer|min:1|max:100',
        ]);

        try {
            $connection = $this->sipService->updateInboundSettings($id, $validated);
            return response()->json($connection);
        } catch (ApiException $e) {
            return response()->json([
                'error' => $e->getMessage(),
                'status_code' => $e->getHttpStatus(),
            ], $e->getHttpStatus());
        }
    }
}
```

Create a webhook controller to handle inbound call events:

```bash
php artisan make:controller WebhookController
```

Edit `app/Http/Controllers/WebhookController.php`:

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class WebhookController extends Controller
{
    /**
     * Handle inbound SIP call webhook events.
     * 
     * Telnyx sends call events to this endpoint. Log and process them here.
     */
    public function handleSipEvent(Request $request): JsonResponse
    {
        $payload = $request->all();

        // Log the event for debugging
        Log::info('SIP Event Received', [
            'event_type' => $payload['data']['event_type'] ?? 'unknown',
            'call_id' => $payload['data']['call_session_id'] ?? null,
        ]);

        // Handle different event types
        $eventType = $payload['data']['event_type'] ?? null;

        switch ($eventType) {
            case 'call.initiated':
                $this->handleCallInitiated($payload['data']);
                break;
            case 'call.answered':
                $this->handleCallAnswered($payload['data']);
                break;
            case 'call.hangup':
                $this->handleCallHangup($payload['data']);
                break;
            default:
                Log::warning('Unknown SIP event type', ['type' => $eventType]);
        }

        // Always return 200 OK to acknowledge receipt
        return response()->json(['status' => 'received'], 200);
    }

    /**
     * Process call.initiated event (inbound call received).
     */
    private function handleCallInitiated(array $data): void
    {
        Log::info('Inbound call initiated', [
            'from' => $data['from']['phone_number'] ?? null,
            'to' => $data['to']['phone_number'] ?? null,
            'call_id' => $data['call_session_id'] ?? null,
        ]);

        // Route the call to your SIP endpoint
        // In production, you would update call routing here
    }

    /**
     * Process call.answered event.
     */
    private function handleCallAnswered(array $data): void
    {
        Log::info('Call answered', [
            'call_id' => $data['call_session_id'] ?? null,
        ]);
    }

    /**
     * Process call.hangup event.
     */
    private function handleCallHangup(array $data): void
    {
        Log::info('Call ended', [
            'call_id' => $data['call_session_id'] ?? null,
            'hangup_reason' => $data['hangup_reason'] ?? null,
        ]);
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\SipConnectionController;
use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

// SIP Connection management routes
Route::apiResource('sip-connections', SipConnectionController::class);

// Webhook route for inbound SIP events (no CSRF protection needed)
Route::post('/webhooks/sip', [WebhookController::class, 'handleSipEvent'])
    ->withoutMiddleware('api')
    ->name('sip.webhook');
```

Disable CSRF protection for the webhook route by updating `app/Http/Middleware/VerifyCsrfToken.php`:

```php
<?php

namespace App\Http\Middleware;

use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken as Middleware;

class VerifyCsrfToken extends Middleware
{
    /**
     * The URIs that should be excluded from CSRF verification.
     *
     * @var array<int, string>
     */
    protected $except = [
        'webhooks/sip',
    ];
}
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | API requests return `{"error": "Unauthorized"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key from the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Laravel server after updating `.env`. |
| SIP Connection Creation Fails | The `POST /api/sip-connections` endpoint returns a 400 or 422 error. | Validate that the request body includes all required fields: `name`, `username`, and `password`. The password must be at least 8 characters. Check the Laravel validation error response for specific field issues. |
| Webhook Events Not Received | Inbound calls occur but webhook logs show no events. | Confirm that your `WEBHOOK_URL` in `.env` is publicly accessible and matches the URL configured in the Telnyx Portal for your phone number. Use ngrok to expose your local server and update the webhook URL. Verify that the webhook route is excluded from CSRF protection in `VerifyCsrfToken.php`. |
| SIP Subdomain Conflict | Creating a connection returns an error about the SIP subdomain already existing. | The subdomain is derived from the connection name. Use a unique connection name that hasn't been used before. Alternatively, manually specify a unique subdomain in the API request. |
| Phone Number Not Routing to Connection | Inbound calls don't reach your SIP endpoint. | In the Telnyx Portal, assign your phone number to the SIP connection you created. Verify that your SIP endpoint address and port are correct in the connection settings. Test connectivity to your SIP endpoint from the Telnyx network. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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

- [Configure SIP Authentication Methods](/tutorials/sip/php/sip-authentication).
- [Set Up SIP Trunking with Failover Routing](/tutorials/sip/php/failover-routing).
- [Make Outbound SIP Calls](/tutorials/sip/php/outbound-sip-call).
