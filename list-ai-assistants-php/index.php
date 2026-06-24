<?php

// app/Services/TelnyxAiService.php
namespace App\Services;

use Telnyx\Client;

class TelnyxAiService
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client(apiKey: env('TELNYX_API_KEY'));
    }

    /**
     * Retrieve all AI assistants with pagination support.
     */
    public function listAssistants(int $page = 1, int $pageSize = 20): array
    {
        $response = $this->client->ai_assistants->list([
            'page' => $page,
            'page_size' => $pageSize,
        ]);

        // Extract serializable data — SDK objects are NOT JSON-serializable
        return [
            'data' => array_map(fn($assistant) => [
                'id' => $assistant->id,
                'name' => $assistant->name,
                'model' => $assistant->model,
                'instructions' => $assistant->instructions,
                'enabled_features' => $assistant->enabled_features,
                'created_at' => $assistant->created_at,
            ], $response->data),
            'pagination' => [
                'page' => $response->meta->page ?? $page,
                'page_size' => $response->meta->page_size ?? $pageSize,
                'total_pages' => $response->meta->total_pages ?? 1,
                'total_results' => $response->meta->total_results ?? count($response->data),
            ],
        ];
    }
}

// app/Http/Controllers/AiAssistantController.php
namespace App\Http\Controllers;

use App\Services\TelnyxAiService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;
use Telnyx\Exception\ApiException;

class AiAssistantController extends Controller
{
    private TelnyxAiService $aiService;

    public function __construct(TelnyxAiService $aiService)
    {
        $this->aiService = $aiService;
    }

    /**
     * List all AI assistants with pagination.
     */
    public function index(Request $request): JsonResponse
    {
        $page = (int) $request->query('page', 1);
        $pageSize = (int) $request->query('page_size', 20);

        // Validate pagination parameters
        if ($page < 1 || $pageSize < 1 || $pageSize > 100) {
            return response()->json([
                'error' => 'Invalid pagination parameters. Page must be >= 1, page_size must be 1-100.'
            ], 400);
        }

        try {
            $result = $this->aiService->listAssistants($page, $pageSize);
            return response()->json($result);

        } catch (AuthenticationException $e) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (RateLimitException $e) {
            return response()->json(['error' => 'Rate limit exceeded. Please slow down.'], 429);
        } catch (ApiException $e) {
            return response()->json([
                'error' => $e->getMessage(),
                'status_code' => $e->getCode()
            ], $e->getCode() ?: 500);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Network error connecting to Telnyx'], 503);
        }
    }
}

// routes/api.php
use App\Http\Controllers\AiAssistantController;
use Illuminate\Support\Facades\Route;

Route::get('/ai/assistants', [AiAssistantController::class, 'index']);
