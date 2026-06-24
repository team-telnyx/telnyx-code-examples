# Create AI Assistant with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel endpoint that creates AI assistants using the Telnyx PHP SDK. This tutorial demonstrates the new client-based initialization pattern, proper error handling for telecom APIs, secure credential management via environment variables, and Laravel's idiomatic patterns for request validation and response serialization.

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
- Basic familiarity with Laravel routing and controllers.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a controller to handle AI assistant creation. Generate it using Artisan:

```bash
php artisan make:controller AiAssistantController
```

Update `app/Http/Controllers/AiAssistantController.php`:

```php
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
```

Register the route in `routes/api.php`:

```php
<?php

use App\Http\Controllers\AiAssistantController;
use Illuminate\Support\Facades\Route;

Route::post('/ai-assistants', [AiAssistantController::class, 'store']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Run `php artisan config:clear` to clear Laravel's configuration cache, then restart the development server. |
| Validation Error (422) | The request returns a 422 Unprocessable Entity response with validation errors. | Ensure all required fields (`name`, `model`, `instructions`) are present in your JSON request body. Verify that `enabled_features` is an array containing only valid values: `"telephony"` or `"messaging"`. Check the response body for specific validation error messages. |
| Model Not Found | The API returns an error stating the model is invalid or not found. | Verify that the `model` parameter uses a valid Telnyx AI model identifier (e.g., `"meta-llama/Meta-Llama-3.1-70B-Instruct"`). Check the [Telnyx AI Assistants documentation](https://developers.telnyx.com/docs/api/ai-assistants) for the complete list of supported models. Ensure the model string is spelled correctly and matches the exact format. |
| Environment Variable Not Loaded | The application raises an error about missing API key or `getenv('TELNYX_API_KEY')` returns null. | Confirm your `.env` file exists in the project root directory and contains `TELNYX_API_KEY=your_key_here`. Run `php artisan config:clear` to clear the configuration cache. Restart the Laravel development server with `php artisan serve`. Verify the `.env` file is not listed in `.gitignore` (it should be for security). |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this AI example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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
