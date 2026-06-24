# SIP Registration with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that manages SIP connection registration with the Telnyx SIP Trunking API. This tutorial demonstrates credential-based SIP authentication, secure credential management via environment variables, and proper error handling for telecom APIs. By the end, you'll have a working SIP trunk configured for inbound and outbound calls through your PBX or SIP endpoint.

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
- A SIP endpoint (PBX, SBC, or softphone) to receive calls.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-registration-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle SIP connection logic. Generate a new service:

```bash
php artisan make:controller SipConnectionController
```

Create a service class at `app/Services/SipConnectionService.php`:

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
     * Create a new SIP connection with credential-based authentication.
     * 
     * @param string $name Connection name for identification.
     * @param string $username SIP registration username.
     * @param string $password SIP registration password.
     * @param string $endpoint SIP endpoint address (e.g., sip.example.com:5060).
     * @return array JSON-serializable connection data.
     */
    public function createConnection(
        string $name,
        string $username,
        string $password,
        string $endpoint
    ): array {
        // Validate endpoint format to prevent API errors
        if (!preg_match('/^[a-zA-Z0-9.-]+:\d+$/', $endpoint)) {
            throw new \InvalidArgumentException(
                'SIP endpoint must be in format: host:port (e.g., sip.example.com:5060)'
            );
        }

        // Create SIP connection with credential authentication
        $response = $this->client->sipConnections->create([
            'name' => $name,
            'outbound_voice_profile_id' => $this->getOrCreateOutboundProfile(),
            'inbound' => [
                'sip_subdomain' => strtolower(str_replace(' ', '-', $name)),
            ],
            'outbound' => [
                'outbound_voice_profile_id' => $this->getOrCreateOutboundProfile(),
            ],
            'credentials' => [
                'authentication' => 'credential',
                'credential_username' => $username,
                'credential_password' => $password,
            ],
        ]);

        // Extract serializable data — SDK objects are NOT JSON-serializable
        return [
            'id' => $response->data->id,
            'name' => $response->data->name,
            'username' => $username,
            'sip_subdomain' => $response->data->inbound->sip_subdomain ?? null,
            'status' => 'created',
        ];
    }

    /**
     * Retrieve an existing SIP connection by ID.
     * 
     * @param string $connectionId The SIP connection ID.
     * @return array JSON-serializable connection data.
     */
    public function getConnection(string $connectionId): array
    {
        $response = $this->client->sipConnections->retrieve($connectionId);

        return [
            'id' => $response->data->id,
            'name' => $response->data->name,
            'username' => $response->data->credentials->credential_username ?? null,
            'sip_subdomain' => $response->data->inbound->sip_subdomain ?? null,
            'created_at' => $response->data->created_at ?? null,
        ];
    }

    /**
     * List all SIP connections for the account.
     * 
     * @return array Array of JSON-serializable connection objects.
     */
    public function listConnections(): array
    {
        $response = $this->client->sipConnections->list();

        return array_map(function ($connection) {
            return [
                'id' => $connection->id,
                'name' => $connection->name,
                'username' => $connection->credentials->credential_username ?? null,
                'sip_subdomain' => $connection->inbound->sip_subdomain ?? null,
            ];
        }, $response->data ?? []);
    }

    /**
     * Update SIP connection credentials.
     * 
     * @param string $connectionId The SIP connection ID.
     * @param string $newPassword New SIP registration password.
     * @return array JSON-serializable updated connection data.
     */
    public function updateConnectionPassword(
        string $connectionId,
        string $newPassword
    ): array {
        $response = $this->client->sipConnections->update($connectionId, [
            'credentials' => [
                'credential_password' => $newPassword,
            ],
        ]);

        return [
            'id' => $response->data->id,
            'name' => $response->data->name,
            'password_updated' => true,
        ];
    }

    /**
     * Delete a SIP connection.
     * 
     * @param string $connectionId The SIP connection ID.
     * @return bool True if deletion was successful.
     */
    public function deleteConnection(string $connectionId): bool
    {
        $this->client->sipConnections->delete($connectionId);
        return true;
    }

    /**
     * Get or create a default outbound voice profile.
     * Required for SIP connections to route outbound calls.
     * 
     * @return string Outbound voice profile ID.
     */
    private function getOrCreateOutboundProfile(): string
    {
        // In production, cache this ID or retrieve from database
        // For this tutorial, we create a minimal profile
        try {
            $response = $this->client->outboundVoiceProfiles->list(['page' => ['size' => 1]]);
            if (!empty($response->data)) {
                return $response->data[0]->id;
            }
        } catch (\Exception $e) {
            // Profile list may fail; create a new one
        }

        // Create a default outbound voice profile
        $profile = $this->client->outboundVoiceProfiles->create([
            'name' => 'Default SIP Profile',
            'concurrency_limit' => 100,
            'daily_spend_limit' => 10000,
        ]);

        return $profile->data->id;
    }
}
```

Now update `app/Http/Controllers/SipConnectionController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\SipConnectionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Exception\ApiException;

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
            'endpoint' => 'required|string|regex:/^[a-zA-Z0-9.-]+:\d+$/',
        ]);

        try {
            $connection = $this->sipService->createConnection(
                $validated['name'],
                $validated['username'],
                $validated['password'],
                $validated['endpoint']
            );

            return response()->json($connection, 201);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        }
    }

    /**
     * Retrieve a specific SIP connection.
     */
    public function show(string $connectionId): JsonResponse
    {
        try {
            $connection = $this->sipService->getConnection($connectionId);
            return response()->json($connection, 200);
        } catch (ApiException $e) {
            if ($e->getHttpStatus() === 404) {
                return response()->json(['error' => 'SIP connection not found'], 404);
            }
            throw $e;
        }
    }

    /**
     * List all SIP connections.
     */
    public function index(): JsonResponse
    {
        try {
            $connections = $this->sipService->listConnections();
            return response()->json($connections, 200);
        } catch (ApiException $e) {
            return response()->json(['error' => 'Failed to list connections'], 500);
        }
    }

    /**
     * Update SIP connection password.
     */
    public function updatePassword(Request $request, string $connectionId): JsonResponse
    {
        $validated = $request->validate([
            'password' => 'required|string|min:8',
        ]);

        try {
            $result = $this->sipService->updateConnectionPassword(
                $connectionId,
                $validated['password']
            );
            return response()->json($result, 200);
        } catch (ApiException $e) {
            return response()->json(['error' => 'Failed to update password'], 500);
        }
    }

    /**
     * Delete a SIP connection.
     */
    public function destroy(string $connectionId): JsonResponse
    {
        try {
            $this->sipService->deleteConnection($connectionId);
            return response()->json(['message' => 'SIP connection deleted'], 200);
        } catch (ApiException $e) {
            return response()->json(['error' => 'Failed to delete connection'], 500);
        }
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\SipConnectionController;
use Illuminate\Support\Facades\Route;

Route::apiResource('sip-connections', SipConnectionController::class);
Route::patch('sip-connections/{connectionId}/password', [
    SipConnectionController::class,
    'updatePassword',
])->name('sip-connections.update-password');
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The API returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Run `php artisan config:clear` to clear cached configuration, then restart the Laravel server. |
| Invalid SIP Endpoint Format | You receive a 400 validation error stating "SIP endpoint must be in format: host:port". | Ensure the endpoint follows the pattern `hostname:port` without the `sip://` prefix. Valid examples: `pbx.example.com:5060`, `192.168.1.100:5061`. Update your request JSON and retry. |
| SIP Connection Not Found (404) | Attempting to retrieve or update a connection returns `{"error": "SIP connection not found"}`. | Verify the connection ID is correct by listing all connections with `GET /api/sip-connections`. The ID must be a valid UUID from a previously created connection. If the connection was deleted, create a new one. |
| Outbound Voice Profile Error | The service fails to create or retrieve an outbound voice profile during connection creation. | This is typically a transient API issue. Retry the request. If the error persists, manually create an outbound voice profile in the [Telnyx Portal](https://portal.telnyx.com) and update the `getOrCreateOutboundProfile()` method to use the profile ID directly. |
| Password Update Fails | Updating the SIP password returns a 500 error. | Ensure the new password meets security requirements (minimum 8 characters). Verify the connection ID is valid. Check that your API key has permissions to update SIP connections in the Telnyx Portal. |

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

- [Configure Outbound SIP Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/php/outbound-sip-call).
- [Set Up Inbound SIP Routing](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/php/inbound-sip-routing).
- [Implement SIP Failover Routing](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/php/failover-routing).
