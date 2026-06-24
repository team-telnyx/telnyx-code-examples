<?php

// app/Services/TelnyxSimService.php
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
        $this->client = new Client(apiKey: env('TELNYX_API_KEY'));
    }

    public function listSimCards(int $limit = 20, ?string $after = null): array
    {
        $params = ['limit' => $limit];
        if ($after) {
            $params['after'] = $after;
        }

        $response = $this->client->simCards->list($params);

        return array_map(fn($sim) => [
            'id' => $sim->id,
            'iccid' => $sim->iccid,
            'status' => $sim->status,
            'sim_card_group_id' => $sim->sim_card_group_id ?? null,
        ], $response->data);
    }

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

    public function getDataUsage(string $simCardId): array
    {
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

    public function isDataUsageExceeded(string $simCardId): bool
    {
        $usage = $this->getDataUsage($simCardId);
        $threshold = config('services.telnyx.data_threshold', 80);

        return $usage['percentage_used'] >= $threshold;
    }

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

// app/Http/Controllers/SimDataController.php
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

    public function handleWebhook(): JsonResponse
    {
        $payload = request()->getContent();
        $signature = request()->header('Telnyx-Signature-ED25519');
        $timestamp = request()->header('Telnyx-Timestamp');

        if (!$this->verifyWebhookSignature($payload, $signature, $timestamp)) {
            return response()->json(['error' => 'Invalid signature'], 401);
        }

        $event = json_decode($payload, true);

        if ($event['data']['event_type'] === 'sim_card.data_limit.reached') {
            $simCardId = $event['data']['sim_card_id'];
            \Log::warning("Data limit reached for SIM: {$simCardId}");
        }

        if ($event['data']['event_type'] === 'sim_card.status.changed') {
            $simCardId = $event['data']['sim_card_id'];
            $newStatus = $event['data']['status'];
            \Log::info("SIM {$simCardId} status changed to: {$newStatus}");
        }

        return response()->json(['status' => 'received'], 200);
    }

    private function verifyWebhookSignature(string $payload, ?string $signature, ?string $timestamp): bool
    {
        if (!$signature || !$timestamp) {
            return false;
        }

        $secret = env('TELNYX_WEBHOOK_SECRET');
        if (!$secret) {
            return false;
        }

        $signedContent = "{$timestamp}.{$payload}";

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

// routes/api.php
use App\Http\Controllers\SimDataController;
use Illuminate\Support\Facades\Route;

Route::prefix('sims')->group(function () {
    Route::get('/', [SimDataController::class, 'listSims']);
    Route::get('/{simCardId}/data-usage', [SimDataController::class, 'getDataUsage']);
    Route::get('/{simCardId}/check-threshold', [SimDataController::class, 'checkDataThreshold']);
});

Route::post('/webhooks/telnyx', [SimDataController::class, 'handleWebhook']);

// config/services.php (add to existing array)
'telnyx' => [
    'api_key' => env('TELNYX_API_KEY'),
    'webhook_secret' => env('TELNYX_WEBHOOK_SECRET'),
    'data_threshold' => env('DATA_USAGE_THRESHOLD_PERCENT', 80),
],
