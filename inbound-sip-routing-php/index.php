<?php
// app/Services/SipConnectionService.php

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

// app/Http/Controllers/SipConnectionController.php

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

// app/Http/Controllers/WebhookController.php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class WebhookController extends Controller
{
    public function handleSipEvent(Request $request): JsonResponse
    {
        $payload = $request->all();

        Log::info('SIP Event Received', [
            'event_type' => $payload['data']['event_type'] ?? 'unknown',
            'call_id' => $payload['data']['call_session_id'] ?? null,
        ]);

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

        return response()->json(['status' => 'received'], 200);
    }

    private function handleCallInitiated(array $data): void
    {
        Log::info('Inbound call initiated', [
            'from' => $data['from']['phone_number'] ?? null,
            'to' => $data['to']['phone_number'] ?? null,
            'call_id' => $data['call_session_id'] ?? null,
        ]);
    }

    private function handleCallAnswered(array $data): void
    {
        Log::info('Call answered', [
            'call_id' => $data['call_session_id'] ?? null,
        ]);
    }

    private function handleCallHangup(array $data): void
    {
        Log::info('Call ended', [
            'call_id' => $data['call_session_id'] ?? null,
            'hangup_reason' => $data['hangup_reason'] ?? null,
        ]);
    }
}

// routes/api.php

use App\Http\Controllers\SipConnectionController;
use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::apiResource('sip-connections', SipConnectionController::class);

Route::post('/webhooks/sip', [WebhookController::class, 'handleSipEvent'])
    ->withoutMiddleware('api')
    ->name('sip.webhook');

// .env

TELNYX_API_KEY=YOUR_API_KEY_HERE
TELNYX_PHONE_NUMBER=+15551234567
SIP_ENDPOINT_ADDRESS=192.168.1.100
SIP_ENDPOINT_PORT=5060
WEBHOOK_URL=https://your-domain.com/webhooks/sip
