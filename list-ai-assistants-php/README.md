# List AI Assistants with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel endpoint that retrieves and displays AI assistants using the Telnyx PHP SDK. This tutorial demonstrates proper client initialization, pagination handling, and secure credential management for AI assistant management systems.

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
- Composer (PHP package manager).
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- Laravel 10.x or higher.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/list-ai-assistants-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/list-ai-assistants-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create the Telnyx AI service in `app/Services/TelnyxAiService.php`:

```php
<?php

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
```

Create a controller to handle the HTTP endpoints:

```bash
php artisan make:controller AiAssistantController
```

Update `app/Http/Controllers/AiAssistantController.php`:

```php
<?php

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
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/list-ai-assistants-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Clear Laravel's config cache with `php artisan config:clear` and restart the development server. |
| Empty Response Array | The API returns `{"data": [], "pagination": {...}}` even though you have assistants in your account. | Check that your API key has the correct permissions for AI assistants in the Telnyx Portal. Verify you're using the production API key if testing against production assistants. Some accounts may have assistants in different regions—confirm your account settings. |
| Pagination Not Working | Large numbers of assistants are not properly paginated, or the `total_pages` field shows incorrect values. | Ensure the `page` and `page_size` parameters are being passed correctly to the Telnyx API. The SDK may have different parameter names—check the latest documentation. Add logging to verify the actual API response structure and adjust the pagination mapping accordingly. |

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

- [Get an AI Assistant](/tutorials/ai/php/get-ai-assistant).
- [Create an AI Assistant](/tutorials/ai/php/create-ai-assistant).
- [Chat with an AI Assistant](/tutorials/ai/php/chat-with-ai-assistant).
