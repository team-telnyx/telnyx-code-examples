# Call Analytics with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that tracks and analyzes call metrics using the Telnyx Voice API. This tutorial demonstrates how to initiate calls, capture webhook events, store call data in a database, and generate analytics reports. You'll learn the command-event model of Call Control, proper webhook handling, and how to extract actionable insights from call logs.

## Who Is This For?

- **PHP developers** building voice features with Laravel.
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
- A Telnyx phone number enabled for outbound calls.
- A Call Control Application ID (connection_id) configured in the Telnyx Portal.
- A publicly accessible URL for webhook delivery (ngrok or similar for local development).
- SQLite or MySQL for storing call analytics.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voice-call-analytics-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle call operations. Generate it with:

```bash
php artisan make:class Services/CallService
```

Edit `app/Services/CallService.php`:

```php
<?php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;
use App\Models\CallAnalytic;
use Carbon\Carbon;

class CallService
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client(apiKey: getenv('TELNYX_API_KEY'));
    }

    /**
     * Initiate an outbound call and log it to analytics.
     */
    public function initiateCall(string $toNumber): array
    {
        $fromNumber = getenv('TELNYX_PHONE_NUMBER');
        $connectionId = getenv('TELNYX_CONNECTION_ID');

        if (!$fromNumber || !$connectionId) {
            throw new \RuntimeException('Missing required environment variables: TELNYX_PHONE_NUMBER or TELNYX_CONNECTION_ID');
        }

        // Validate E.164 format
        if (!str_starts_with($toNumber, '+')) {
            throw new \InvalidArgumentException('Phone number must be in E.164 format (e.g., +15551234567)');
        }

        // Initiate the call via Telnyx API
        $response = $this->client->calls->dial(
            from_: $fromNumber,
            to: $toNumber,
            connection_id: $connectionId,
        );

        $callControlId = $response->data->call_control_id;

        // Log the call to analytics database
        CallAnalytic::create([
            'call_control_id' => $callControlId,
            'from_number' => $fromNumber,
            'to_number' => $toNumber,
            'status' => 'initiated',
            'initiated_at' => Carbon::now(),
            'metadata' => [
                'initiated_via' => 'api',
            ],
        ]);

        return [
            'call_control_id' => $callControlId,
            'from' => $fromNumber,
            'to' => $toNumber,
            'status' => 'initiated',
        ];
    }

    /**
     * Retrieve call status and analytics.
     */
    public function getCallStatus(string $callControlId): array
    {
        $response = $this->client->calls->retrieve_status($callControlId);

        $call = CallAnalytic::where('call_control_id', $callControlId)->first();

        return [
            'call_control_id' => $response->data->call_control_id,
            'is_alive' => $response->data->is_alive,
            'status' => $call?->status ?? 'unknown',
            'duration_seconds' => $call?->duration_seconds,
            'initiated_at' => $call?->initiated_at,
            'answered_at' => $call?->answered_at,
        ];
    }

    /**
     * Hangup a call.
     */
    public function hangupCall(string $callControlId): array
    {
        $response = $this->client->calls->actions->hangup($callControlId);

        return [
            'call_control_id' => $response->data->call_control_id,
            'status' => 'hangup_requested',
        ];
    }

    /**
     * Get analytics summary for a date range.
     */
    public function getAnalyticsSummary(string $startDate, string $endDate): array
    {
        $calls = CallAnalytic::whereBetween('initiated_at', [
            Carbon::parse($startDate)->startOfDay(),
            Carbon::parse($endDate)->endOfDay(),
        ])->get();

        $totalCalls = $calls->count();
        $completedCalls = $calls->where('status', 'completed')->count();
        $failedCalls = $calls->where('status', 'failed')->count();
        $totalDuration = $calls->sum('duration_seconds') ?? 0;
        $averageDuration = $totalCalls > 0 ? $totalDuration / $totalCalls : 0;

        return [
            'period' => [
                'start' => $startDate,
                'end' => $endDate,
            ],
            'total_calls' => $totalCalls,
            'completed_calls' => $completedCalls,
            'failed_calls' => $failedCalls,
            'success_rate' => $totalCalls > 0 ? round(($completedCalls / $totalCalls) * 100, 2) : 0,
            'total_duration_seconds' => $totalDuration,
            'average_duration_seconds' => round($averageDuration, 2),
        ];
    }
}
```

Create a controller to handle HTTP requests. Generate it with:

```bash
php artisan make:controller CallController
```

Edit `app/Http/Controllers/CallController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\CallService;
use Telnyx\Exception\ApiException;
use Telnyx\Exception\AuthenticationException;
use Telnyx\Exception\RateLimitException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CallController extends Controller
{
    private CallService $callService;

    public function __construct(CallService $callService)
    {
        $this->callService = $callService;
    }

    /**
     * Initiate an outbound call.
     */
    public function initiate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'to' => 'required|string|regex:/^\+\d{10,15}$/',
        ]);

        try {
            $result = $this->callService->initiateCall($validated['to']);
            return response()->json($result, 201);
        } catch (AuthenticationException) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (RateLimitException) {
            return response()->json(['error' => 'Rate limit exceeded'], 429);
        } catch (ApiException $e) {
            return response()->json(['error' => $e->getMessage()], $e->getHttpStatus() ?? 400);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Internal server error'], 500);
        }
    }

    /**
     * Get call status and analytics.
     */
    public function status(string $callControlId): JsonResponse
    {
        try {
            $result = $this->callService->getCallStatus($callControlId);
            return response()->json($result, 200);
        } catch (AuthenticationException) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (ApiException $e) {
            return response()->json(['error' => $e->getMessage()], $e->getHttpStatus() ?? 400);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Internal server error'], 500);
        }
    }

    /**
     * Hangup a call.
     */
    public function hangup(string $callControlId): JsonResponse
    {
        try {
            $result = $this->callService->hangupCall($callControlId);
            return response()->json($result, 200);
        } catch (AuthenticationException) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (ApiException $e) {
            return response()->json(['error' => $e->getMessage()], $e->getHttpStatus() ?? 400);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Internal server error'], 500);
        }
    }

    /**
     * Get analytics summary for a date range.
     */
    public function analytics(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'start_date' => 'required|date',
            'end_date' => 'required|date|after_or_equal:start_date',
        ]);

        try {
            $result = $this->callService->getAnalyticsSummary(
                $validated['start_date'],
                $validated['end_date']
            );
            return response()->json($result, 200);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Internal server error'], 500);
        }
    }
}
```

Create a webhook controller to handle Telnyx events. Generate it with:

```bash
php artisan make:controller WebhookController
```

Edit `app/Http/Controllers/WebhookController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Models\CallAnalytic;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WebhookController extends Controller
{
    /**
     * Handle incoming Telnyx webhook events.
     */
    public function handleCallEvent(Request $request): JsonResponse
    {
        $payload = $request->all();

        // Verify webhook signature (optional but recommended for production)
        // See Telnyx documentation for signature verification

        $eventType = $payload['data']['event_type'] ?? null;
        $callControlId = $payload['data']['call_control_id'] ?? null;

        if (!$callControlId) {
            return response()->json(['error' => 'Missing call_control_id'], 400);
        }

        $call = CallAnalytic::where('call_control_id', $callControlId)->first();

        if (!$call) {
            return response()->json(['error' => 'Call not found'], 404);
        }

        // Handle different event types
        match ($eventType) {
            'call.initiated' => $this->handleCallInitiated($call, $payload),
            'call.answered' => $this->handleCallAnswered($call, $payload),
            'call.hangup' => $this->handleCallHangup($call, $payload),
            default => null,
        };

        return response()->json(['status' => 'received'], 200);
    }

    /**
     * Handle call.initiated event.
     */
    private function handleCallInitiated(CallAnalytic $call, array $payload): void
    {
        $call->update([
            'status' => 'initiated',
            'metadata' => array_merge($call->metadata ?? [], [
                'initiated_timestamp' => $payload['data']['occurred_at'] ?? null,
            ]),
        ]);
    }

    /**
     * Handle call.answered event.
     */
    private function handleCallAnswered(CallAnalytic $call, array $payload): void
    {
        $call->update([
            'status' => 'answered',
            'answered_at' => Carbon::now(),
            'metadata' => array_merge($call->metadata ?? [], [
                'answered_timestamp' => $payload['data']['occurred_at'] ?? null,
            ]),
        ]);
    }

    /**
     * Handle call.hangup event.
     */
    private function handleCallHangup(CallAnalytic $call, array $payload): void
    {
        $endedAt = Carbon::now();
        $durationSeconds = $call->initiated_at
            ? $endedAt->diffInSeconds($call->initiated_at)
            : 0;

        $call->update([
            'status' => 'completed',
            'ended_at' => $endedAt,
            'duration_seconds' => $durationSeconds,
            'metadata' => array_merge($call->metadata ?? [], [
                'hangup_timestamp' => $payload['data']['occurred_at'] ?? null,
                'hangup_reason' => $payload['data']['hangup_reason'] ?? null,
            ]),
        ]);
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\CallController;
use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::post('/calls/initiate', [CallController::class, 'initiate']);
Route::get('/calls/{callControlId}/status', [CallController::class, 'status']);
Route::post('/calls/{callControlId}/hangup', [CallController::class, 'hangup']);
Route::get('/analytics', [CallController::class, 'analytics']);

Route::post('/webhooks/call', [WebhookController::class, 'handleCallEvent']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voice-call-analytics-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Laravel server with `php artisan serve`. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Events Not Received | Call events are initiated but webhook handler never receives `call.answered` or `call.hangup` events. | Verify that the webhook URL in your Telnyx Call Control Application settings matches your ngrok URL or public domain. Ensure the route `/api/webhooks/call` is registered in `routes/api.php` and is not protected by CSRF middleware. Add `\App\Http\Middleware\VerifyCsrfToken::class` to the `$except` array in `app/Http/Middleware/VerifyCsrfToken.php` for the webhook route. |
| Database Migration Fails | Running `php artisan migrate` returns an error about table already existing or column conflicts. | Drop the existing table with `php artisan migrate:reset` or manually delete the `call_analytics` table from your database. Then run `php artisan migrate` again. Ensure your database connection is properly configured in `.env` (check `DB_CONNECTION`, `DB_HOST`, `DB_DATABASE`). |
| Call Control ID Not Found | Status or hangup requests return `{"error": "Call not found"}` even though the call was initiated. | Verify that the `call_control_id` from the initiate response is being stored correctly in the database. Check the `call_analytics` table to confirm the record exists. Ensure you are using the exact `call_control_id` returned from the initiate endpoint, not the connection ID. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What PHP version do I need?**

PHP 8.1 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Voice API Overview](https://developers.telnyx.com/docs/voice)
- [Voice API Commands](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources)
- [AI Assistant Start](https://developers.telnyx.com/docs/voice/programmable-voice/ai-assistant-start)
- [Call Control API Reference](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Telnyx Voice API](https://telnyx.com/products/voice-api)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [Handle Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/inbound-call-webhook).
- [Record and Store Call Audio](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/call-recording).
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/call-transfer).
