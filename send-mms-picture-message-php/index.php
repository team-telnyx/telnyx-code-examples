<?php

// app/Services/TelnyxMmsService.php
namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;

class TelnyxMmsService
{
    private Client $client;
    private string $fromNumber;

    public function __construct()
    {
        $this->client = new Client(apiKey: config('services.telnyx.api_key'));
        $this->fromNumber = config('services.telnyx.phone_number');

        if (!$this->fromNumber) {
            throw new \RuntimeException('TELNYX_PHONE_NUMBER environment variable not set');
        }
    }

    /**
     * Send MMS message with media attachments.
     *
     * @param string $toNumber Recipient phone number in E.164 format.
     * @param string $message Message text content.
     * @param array $mediaUrls Array of publicly accessible media URLs (images, videos, etc.).
     * @return array JSON-serializable response data.
     * @throws \InvalidArgumentException If phone number format is invalid.
     * @throws ApiException If Telnyx API call fails.
     */
    public function sendMms(string $toNumber, string $message, array $mediaUrls): array
    {
        // Validate E.164 format to prevent API errors
        if (!str_starts_with($toNumber, '+')) {
            throw new \InvalidArgumentException(
                'Phone number must be in E.164 format (e.g., +15551234567)'
            );
        }

        if (empty($mediaUrls)) {
            throw new \InvalidArgumentException(
                'At least one media URL is required for MMS'
            );
        }

        // Validate media URLs are accessible
        foreach ($mediaUrls as $url) {
            if (!filter_var($url, FILTER_VALIDATE_URL)) {
                throw new \InvalidArgumentException(
                    "Invalid media URL: {$url}"
                );
            }
        }

        // Create MMS message via Telnyx API
        $response = $this->client->messages->create([
            'from_' => $this->fromNumber,
            'to' => $toNumber,
            'text' => $message,
            'media_urls' => $mediaUrls,
        ]);

        // Extract serializable data — SDK objects are NOT JSON-serializable
        return [
            'message_id' => $response->data->id,
            'status' => $response->data->to[0]->status ?? 'pending',
            'from' => $this->fromNumber,
            'to' => $toNumber,
            'media_count' => count($mediaUrls),
        ];
    }
}

// app/Http/Controllers/MmsController.php
namespace App\Http\Controllers;

use App\Services\TelnyxMmsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;

class MmsController extends Controller
{
    public function __construct(private TelnyxMmsService $mmsService)
    {
    }

    /**
     * Send MMS message endpoint.
     *
     * POST /api/mms/send
     * {
     *   "to": "+15559876543",
     *   "message": "Check out this image!",
     *   "media_urls": ["https://example.com/image.jpg"]
     * }
     */
    public function send(Request $request): JsonResponse
    {
        // Validate request input
        $validated = $request->validate([
            'to' => 'required|string|regex:/^\+\d{1,15}$/',
            'message' => 'required|string|max:1000',
            'media_urls' => 'required|array|min:1',
            'media_urls.*' => 'required|url',
        ]);

        try {
            $result = $this->mmsService->sendMms(
                $validated['to'],
                $validated['message'],
                $validated['media_urls']
            );

            return response()->json($result, 200);

        } catch (AuthenticationException) {
            return response()->json(['error' => 'Invalid API key'], 401);

        } catch (RateLimitException) {
            return response()->json(
                ['error' => 'Rate limit exceeded. Please slow down.'],
                429
            );

        } catch (ApiException $e) {
            return response()->json(
                [
                    'error' => $e->getMessage(),
                    'status_code' => $e->getHttpStatus(),
                ],
                $e->getHttpStatus() ?? 500
            );

        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 400);

        } catch (\Exception $e) {
            return response()->json(
                ['error' => 'Network error connecting to Telnyx'],
                503
            );
        }
    }
}

// routes/api.php
use App\Http\Controllers\MmsController;
use Illuminate\Support\Facades\Route;

Route::post('/mms/send', [MmsController::class, 'send']);

// config/services.php (add to existing array)
'telnyx' => [
    'api_key' => env('TELNYX_API_KEY'),
    'phone_number' => env('TELNYX_PHONE_NUMBER'),
],

// .env
TELNYX_API_KEY=YOUR_API_KEY_HERE
TELNYX_PHONE_NUMBER=+15551234567
