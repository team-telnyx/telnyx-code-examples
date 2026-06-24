# Call Forwarding with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that implements intelligent call forwarding using the Telnyx Voice API. This tutorial demonstrates how to receive inbound calls via webhooks, forward them to alternative numbers based on business logic, and handle call state transitions with proper error handling and logging.

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
- A Telnyx phone number enabled for inbound calls.
- A publicly accessible URL for webhook callbacks (ngrok, Expose, or production server).
- Basic understanding of Laravel routing and middleware.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-forwarding-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-forwarding-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a migration to store call forwarding state:

```bash
php artisan make:migration create_call_forwards_table
```

Edit the migration file in `database/migrations/`:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('call_forwards', function (Blueprint $table) {
            $table->id();
            $table->string('call_control_id')->unique();
            $table->string('from_number');
            $table->string('to_number');
            $table->string('status')->default('initiated'); // initiated, answered, transferred, completed
            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('updated_at')->useCurrent();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('call_forwards');
    }
};
```

Run the migration:

```bash
php artisan migrate
```

Create a model for call forwarding:

```bash
php artisan make:model CallForward
```

Edit `app/Models/CallForward.php`:

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CallForward extends Model
{
    protected $fillable = [
        'call_control_id',
        'from_number',
        'to_number',
        'status',
    ];

    public $timestamps = true;
}
```

Create a service class to handle call forwarding logic:

```bash
php artisan make:class Services/CallForwardingService
```

Edit `app/Services/CallForwardingService.php`:

```php
<?php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;
use App\Models\CallForward;
use Illuminate\Support\Facades\Log;

class CallForwardingService
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client(apiKey: config('services.telnyx.api_key'));
    }

    /**
     * Answer an inbound call and initiate forwarding.
     */
    public function answerAndForward(string $callControlId, string $fromNumber): array
    {
        try {
            // Answer the inbound call
            $this->client->calls->actions->answer($callControlId);

            // Log the call
            CallForward::create([
                'call_control_id' => $callControlId,
                'from_number' => $fromNumber,
                'to_number' => config('services.telnyx.forward_to'),
                'status' => 'answered',
            ]);

            Log::info("Call answered and logged", ['call_control_id' => $callControlId]);

            return [
                'success' => true,
                'call_control_id' => $callControlId,
                'status' => 'answered',
            ];
        } catch (ApiException $e) {
            Log::error("Failed to answer call", [
                'call_control_id' => $callControlId,
                'error' => $e->getMessage(),
            ]);

            return [
                'success' => false,
                'error' => $e->getMessage(),
            ];
        }
    }

    /**
     * Transfer the call to the forwarding destination.
     */
    public function transferCall(string $callControlId): array
    {
        try {
            $forwardTo = config('services.telnyx.forward_to');

            // Transfer the call to the destination number
            $this->client->calls->actions->transfer(
                $callControlId,
                to: $forwardTo
            );

            // Update call status
            CallForward::where('call_control_id', $callControlId)
                ->update(['status' => 'transferred']);

            Log::info("Call transferred", [
                'call_control_id' => $callControlId,
                'to' => $forwardTo,
            ]);

            return [
                'success' => true,
                'call_control_id' => $callControlId,
                'transferred_to' => $forwardTo,
            ];
        } catch (ApiException $e) {
            Log::error("Failed to transfer call", [
                'call_control_id' => $callControlId,
                'error' => $e->getMessage(),
            ]);

            return [
                'success' => false,
                'error' => $e->getMessage(),
            ];
        }
    }

    /**
     * Hangup a call and mark as completed.
     */
    public function hangupCall(string $callControlId): array
    {
        try {
            $this->client->calls->actions->hangup($callControlId);

            // Update call status
            CallForward::where('call_control_id', $callControlId)
                ->update(['status' => 'completed']);

            Log::info("Call hung up", ['call_control_id' => $callControlId]);

            return [
                'success' => true,
                'call_control_id' => $callControlId,
                'status' => 'completed',
            ];
        } catch (ApiException $e) {
            Log::error("Failed to hangup call", [
                'call_control_id' => $callControlId,
                'error' => $e->getMessage(),
            ]);

            return [
                'success' => false,
                'error' => $e->getMessage(),
            ];
        }
    }

    /**
     * Get call forwarding history.
     */
    public function getCallHistory(int $limit = 50): array
    {
        $calls = CallForward::latest()->limit($limit)->get();

        return array_map(fn($call) => [
            'id' => $call->id,
            'call_control_id' => $call->call_control_id,
            'from_number' => $call->from_number,
            'to_number' => $call->to_number,
            'status' => $call->status,
            'created_at' => $call->created_at->toIso8601String(),
        ], $calls->toArray());
    }
}
```

Create a controller to handle webhook events:

```bash
php artisan make:controller WebhookController
```

Edit `app/Http/Controllers/WebhookController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Services\CallForwardingService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

class WebhookController extends Controller
{
    private CallForwardingService $callForwardingService;

    public function __construct(CallForwardingService $callForwardingService)
    {
        $this->callForwardingService = $callForwardingService;
    }

    /**
     * Handle inbound call webhooks from Telnyx.
     */
    public function handleCall(Request $request): JsonResponse
    {
        $payload = $request->all();
        $eventType = $payload['data']['event_type'] ?? null;
        $callControlId = $payload['data']['call_control_id'] ?? null;

        Log::info("Webhook received", [
            'event_type' => $eventType,
            'call_control_id' => $callControlId,
        ]);

        if (!$callControlId) {
            return response()->json(['error' => 'Missing call_control_id'], 400);
        }

        try {
            switch ($eventType) {
                case 'call.initiated':
                    // Inbound call received — answer and prepare to forward
                    $fromNumber = $payload['data']['from']['phone_number'] ?? 'unknown';
                    $result = $this->callForwardingService->answerAndForward(
                        $callControlId,
                        $fromNumber
                    );
                    return response()->json($result);

                case 'call.answered':
                    // Call answered — initiate transfer to forwarding destination
                    $result = $this->callForwardingService->transferCall($callControlId);
                    return response()->json($result);

                case 'call.hangup':
                    // Call ended — log completion
                    $result = $this->callForwardingService->hangupCall($callControlId);
                    return response()->json($result);

                default:
                    Log::info("Unhandled event type", ['event_type' => $eventType]);
                    return response()->json(['status' => 'acknowledged'], 200);
            }
        } catch (\Exception $e) {
            Log::error("Webhook processing error", [
                'error' => $e->getMessage(),
                'call_control_id' => $callControlId,
            ]);

            return response()->json([
                'error' => 'Internal server error',
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Retrieve call forwarding history.
     */
    public function getHistory(): JsonResponse
    {
        try {
            $history = $this->callForwardingService->getCallHistory();
            return response()->json(['calls' => $history], 200);
        } catch (\Exception $e) {
            Log::error("Failed to retrieve call history", ['error' => $e->getMessage()]);
            return response()->json(['error' => 'Failed to retrieve history'], 500);
        }
    }
}
```

Register the webhook routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::post('/webhooks/call', [WebhookController::class, 'handleCall']);
Route::get('/call-history', [WebhookController::class, 'getHistory']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-forwarding-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | The `/api/webhooks/call` endpoint is not being called when inbound calls arrive. | Verify that your Telnyx Call Control Application webhook URL is set to your public URL (e.g., `https://abc123.ngrok.io/api/webhooks/call`). Check the Telnyx Portal under Call Control Applications and confirm the webhook URL matches exactly. Ensure ngrok is running and the tunnel is active. Check Laravel logs with `tail -f storage/logs/laravel.log` for incoming requests. |
| Call transfer fails with API error | The `transferCall()` method throws an `ApiException` with message about invalid destination. | Verify that `FORWARD_TO_NUMBER` in your `.env` file is in E.164 format (e.g., `+15559876543`). Ensure the destination number is a valid, active phone number. Check that your Telnyx account has sufficient credits and the destination number is not blocked or restricted. Review the error message in the logs for specific API status codes. |
| Database migration fails | Running `php artisan migrate` returns an error about the `call_forwards` table. | Ensure your `.env` file has correct database credentials (`DB_HOST`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`). Run `php artisan migrate:fresh` to reset migrations if you have conflicting table definitions. Check that the database user has CREATE TABLE permissions. Verify the migration file syntax matches Laravel's schema builder conventions. |
| Call history endpoint returns empty array | The `/api/call-history` endpoint returns `{"calls": []}` even after receiving calls. | Verify that the webhook is actually being triggered by checking `storage/logs/laravel.log` for "Webhook received" entries. Confirm that `CallForward::create()` is being called in the `answerAndForward()` method. Check the database directly with `php artisan tinker` and run `App\Models\CallForward::all()` to see if records exist. Ensure the migration has been run with `php artisan migrate`. |
| Authentication error (401) | The Telnyx SDK throws an `AuthenticationError` when initializing the client. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key from the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no leading/trailing spaces or quotes around the key value. If the key was recently regenerated, update your `.env` file and restart the Laravel server with `php artisan serve`. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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

- [Handle Inbound Calls with Webhooks](/tutorials/voice/php/inbound-call-webhook).
- [Record Phone Calls](/tutorials/voice/php/call-recording).
- [Build an IVR Menu System](/tutorials/voice/php/ivr-menu).
