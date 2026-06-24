<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Client;

class AiAssistantController extends Controller
{
    private Client $client;

    public function __construct()
    {
        // Initialize Telnyx client with API key from environment
        $this->client = new Client(apiKey: getenv('TELNYX_API_KEY'));
    }

    /**
     * Create a new AI assistant.
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function store(Request $request): JsonResponse
    {
        // Validate incoming request data
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'model' => 'required|string',
            'instructions' => 'required|string',
            'enabled_features' => 'array',
            'enabled_features.*' => 'string|in:telephony,messaging',
        ]);

        try {
            // Create assistant via Telnyx API
            $response = $this->client->aiAssistants->create([
                'name' => $validated['name'],
                'model' => $validated['model'],
                'instructions' => $validated['instructions'],
                'enabled_features' => $validated['enabled_features'] ?? [],
            ]);

            // Extract serializable data — SDK objects are NOT JSON-serializable
            return response()->json([
                'id' => $response->data->id,
                'name' => $response->data->name,
                'model' => $response->data->model,
                'instructions' => $response->data->instructions,
                'enabled_features' => $response->data->enabled_features,
                'created_at' => $response->data->created_at,
            ], 201);

        } catch (\Telnyx\Exception\AuthenticationException $e) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (\Telnyx\Exception\RateLimitException $e) {
            return response()->json(['error' => 'Rate limit exceeded. Please slow down.'], 429);
        } catch (\Telnyx\Exception\ApiErrorException $e) {
            return response()->json(
                ['error' => $e->getMessage()],
                $e->getHttpStatus() ?? 400
            );
        } catch (\Exception $e) {
            return response()->json(['error' => 'An unexpected error occurred'], 500);
        }
    }
}
