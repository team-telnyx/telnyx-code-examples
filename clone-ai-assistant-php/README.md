# Clone AI Assistant with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel endpoint that clones an existing AI Assistant using the Telnyx PHP SDK. This tutorial demonstrates how to duplicate an assistant's configuration, including its model, instructions, and tools, while maintaining security through environment variables and proper error handling for telecom APIs.

## Who Is This For?

- **PHP developers** building ai features with Laravel.
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
- An existing AI Assistant ID to clone (create one first if needed).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/clone-ai-assistant-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle AI Assistant cloning logic. Generate a new service:

```bash
php artisan make:service AiAssistantService
```

Edit `app/Services/AiAssistantService.php`:

```php
<?php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;

class AiAssistantService
{
    private Client $client;

    public function __construct()
    {
        // Initialize Telnyx client with API key from environment
        $this->client = new Client(apiKey: getenv('TELNYX_API_KEY'));
    }

    /**
     * Clone an existing AI Assistant.
     *
     * @param string $assistantId The ID of the assistant to clone.
     * @param string|null $newName Optional new name for the cloned assistant.
     * @return array JSON-serializable response data.
     * @throws ApiException
     */
    public function cloneAssistant(string $assistantId, ?string $newName = null): array
    {
        // Validate assistant ID format
        if (empty($assistantId)) {
            throw new \InvalidArgumentException('Assistant ID cannot be empty');
        }

        // Call the clone endpoint via the SDK
        // The SDK returns a response object with cloned assistant data
        $response = $this->client->ai_assistants->clone($assistantId, [
            'name' => $newName,
        ]);

        // Extract serializable data — SDK objects are NOT JSON-serializable
        return [
            'id' => $response->data->id,
            'name' => $response->data->name,
            'model' => $response->data->model,
            'instructions' => $response->data->instructions,
            'enabled_features' => $response->data->enabled_features ?? [],
            'created_at' => $response->data->created_at,
        ];
    }

    /**
     * Retrieve an assistant by ID to verify it exists before cloning.
     *
     * @param string $assistantId The ID of the assistant to retrieve.
     * @return array JSON-serializable response data.
     * @throws ApiException
     */
    public function getAssistant(string $assistantId): array
    {
        if (empty($assistantId)) {
            throw new \InvalidArgumentException('Assistant ID cannot be empty');
        }

        $response = $this->client->ai_assistants->retrieve($assistantId);

        return [
            'id' => $response->data->id,
            'name' => $response->data->name,
            'model' => $response->data->model,
            'instructions' => $response->data->instructions,
            'enabled_features' => $response->data->enabled_features ?? [],
            'created_at' => $response->data->created_at,
        ];
    }
}
```

Create a controller to handle HTTP requests. Generate a new controller:

```bash
php artisan make:controller AiAssistantController
```

Edit `app/Http/Controllers/AiAssistantController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\AiAssistantService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Exception\ApiException;

class AiAssistantController extends Controller
{
    private AiAssistantService $assistantService;

    public function __construct(AiAssistantService $assistantService)
    {
        $this->assistantService = $assistantService;
    }

    /**
     * Clone an AI Assistant.
     *
     * POST /api/assistants/{assistantId}/clone
     * Body: { "name": "Optional new name" }
     */
    public function clone(Request $request, string $assistantId): JsonResponse
    {
        // Validate input
        $validated = $request->validate([
            'name' => 'nullable|string|max:255',
        ]);

        try {
            // Call service to clone the assistant
            $clonedAssistant = $this->assistantService->cloneAssistant(
                $assistantId,
                $validated['name'] ?? null
            );

            return response()->json([
                'success' => true,
                'data' => $clonedAssistant,
            ], 201);

        } catch (\InvalidArgumentException $e) {
            return response()->json([
                'error' => $e->getMessage(),
            ], 400);
        }
    }

    /**
     * Get an AI Assistant by ID.
     *
     * GET /api/assistants/{assistantId}
     */
    public function show(string $assistantId): JsonResponse
    {
        try {
            $assistant = $this->assistantService->getAssistant($assistantId);

            return response()->json([
                'success' => true,
                'data' => $assistant,
            ], 200);

        } catch (\InvalidArgumentException $e) {
            return response()->json([
                'error' => $e->getMessage(),
            ], 400);
        }
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\AiAssistantController;
use Illuminate\Support\Facades\Route;

Route::prefix('assistants')->group(function () {
    // Get a specific assistant
    Route::get('{assistantId}', [AiAssistantController::class, 'show']);

    // Clone an assistant
    Route::post('{assistantId}/clone', [AiAssistantController::class, 'clone']);
});
```

Create a global exception handler to catch Telnyx API errors. Edit `app/Exceptions/Handler.php`:

```php
<?php

namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Illuminate\Http\JsonResponse;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;
use Throwable;

class Handler extends ExceptionHandler
{
    /**
     * The list of the inputs that are never flashed to the session on validation exceptions.
     *
     * @var array<int, string>
     */
    protected $dontFlash = [
        'current_password',
        'password',
        'password_confirmation',
    ];

    /**
     * Register the exception handling callbacks for the application.
     */
    public function register(): void
    {
        $this->reportable(function (Throwable $e) {
            //
        });
    }

    /**
     * Render an exception into an HTTP response.
     */
    public function render($request, Throwable $exception): JsonResponse
    {
        // Handle Telnyx authentication errors
        if ($exception instanceof AuthenticationException) {
            return response()->json([
                'error' => 'Invalid API key or authentication failed',
            ], 401);
        }

        // Handle Telnyx rate limit errors
        if ($exception instanceof RateLimitException) {
            return response()->json([
                'error' => 'Rate limit exceeded. Please slow down.',
            ], 429);
        }

        // Handle general Telnyx API errors
        if ($exception instanceof ApiException) {
            return response()->json([
                'error' => $exception->getMessage(),
                'status_code' => $exception->getCode(),
            ], $exception->getCode() ?: 500);
        }

        // Default error response
        return response()->json([
            'error' => 'An unexpected error occurred',
        ], 500);
    }
}
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/clone-ai-assistant-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key or authentication failed"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Laravel development server with `php artisan serve` after updating the `.env` file. |
| Assistant Not Found (404) | The API returns an error indicating the assistant ID does not exist. | Confirm the assistant ID is correct and exists in your Telnyx account. Retrieve the list of assistants from the [Telnyx Portal](https://portal.telnyx.com) or use a list endpoint to verify the ID before attempting to clone. |
| Invalid Request Body | The endpoint returns a validation error for the `name` field. | Ensure the request body is valid JSON and the `name` field (if provided) is a string with a maximum of 255 characters. Example: `{"name": "My Cloned Assistant"}`. If cloning without a custom name, send an empty object `{}`. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this AI example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What PHP version do I need?**

PHP 8.1 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Assistants API Reference](https://developers.telnyx.com/api-reference/assistants/create-an-assistant)
- [Telnyx AI Assistants](https://telnyx.com/ai-assistants)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [List AI Assistants](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/php/list-ai-assistants).
- [Get an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/php/get-ai-assistant).
- [Chat with an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/php/chat-with-ai-assistant).
