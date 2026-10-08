<?php
// app/Services/CnamLookupService.php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;

class CnamLookupService
{
    private Client $client;

    public function __construct()
    {
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
        if (!preg_match('/^\+\d{1,15}$/', $phoneNumber)) {
            throw new \InvalidArgumentException(
                'Phone number must be in E.164 format (e.g., +15551234567)'
            );
        }

        $response = $this->client->request(
            'GET',
            "/v2/number_lookup/{$phoneNumber}",
            ['type' => 'caller-name']
        );

        $data = $response['data'] ?? [];
        return [
            'phone_number' => $phoneNumber,
            'caller_name' => $data['caller_name']['caller_name'] ?? null,
            'carrier_name' => $data['carrier']['name'] ?? null,
            'phone_type' => $data['carrier']['type'] ?? null,
            'country_code' => $data['country_code'] ?? null,
            'valid' => $data['valid'] ?? null,
        ];
    }
}

// app/Http/Controllers/CnamLookupController.php

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
        $validated = $request->validate([
            'phone_number' => 'required|string',
        ]);

        $phoneNumber = $validated['phone_number'];

        try {
            $result = $this->cnamService->lookup($phoneNumber);
            return response()->json($result, 200);

        } catch (\InvalidArgumentException $e) {
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
        $validated = $request->validate([
            'phone_numbers' => 'required|array',
            'phone_numbers.*' => 'string',
        ]);

        $results = [];
        $errors = [];

        foreach ($validated['phone_numbers'] as $phoneNumber) {
            try {
                $results[] = $this->cnamService->lookup($phoneNumber);
            } catch (\InvalidArgumentException $e) {
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

// routes/api.php

use App\Http\Controllers\CnamLookupController;
use Illuminate\Support\Facades\Route;

Route::post('/cnam/lookup', [CnamLookupController::class, 'lookup']);
Route::post('/cnam/batch-lookup', [CnamLookupController::class, 'batchLookup']);

// app/Exceptions/Handler.php

namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Illuminate\Http\JsonResponse;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;
use Throwable;

class Handler extends ExceptionHandler
{
    public function register(): void
    {
        $this->reportable(function (Throwable $e) {
            //
        });
    }

    public function render($request, Throwable $exception): JsonResponse
    {
        if ($exception instanceof AuthenticationException) {
            return response()->json([
                'error' => 'Invalid API key or authentication failed',
                'status' => 401,
            ], 401);
        }

        if ($exception instanceof RateLimitException) {
            return response()->json([
                'error' => 'Rate limit exceeded. Please slow down.',
                'status' => 429,
            ], 429);
        }

        if ($exception instanceof ApiException) {
            $statusCode = $exception->getHttpStatus() ?? 500;
            return response()->json([
                'error' => $exception->getMessage(),
                'status' => $statusCode,
            ], $statusCode);
        }

        return parent::render($request, $exception);
    }
}

// .env

TELNYX_API_KEY=YOUR_API_KEY_HERE
