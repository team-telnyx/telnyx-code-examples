# Warm Transfer with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that implements warm transfer—a call control pattern where an agent can place a caller on hold, speak with a transfer recipient, and then bridge the two parties together. This tutorial demonstrates the Telnyx Voice API's call control commands, webhook event handling, and state management for multi-party call scenarios.

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
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for inbound and outbound calls.
- A Call Control Application configured in the Telnyx Portal with a webhook URL.
- Composer (PHP package manager).
- A publicly accessible URL for receiving webhooks (ngrok or similar for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/warm-transfer-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to encapsulate call control logic. Generate it using Artisan:

```bash
php artisan make:service CallControlService
```

Edit `app/Services/CallControlService.php`:

```php
<?php

namespace App\Services;

use Telnyx\Client;
use Telnyx\Exception\ApiException;

class CallControlService
{
    private Client $client;
    private string $phoneNumber;
    private string $connectionId;

    public function __construct()
    {
        $this->client = new Client(apiKey: env('TELNYX_API_KEY'));
        $this->phoneNumber = env('TELNYX_PHONE_NUMBER');
        $this->connectionId = env('TELNYX_CONNECTION_ID');
    }

    /**
     * Initiate an outbound call to a transfer recipient.
     * Returns the call_control_id for subsequent control actions.
     */
    public function initiateCall(string $toNumber): array
    {
        $response = $this->client->calls->dial(
            from_: $this->phoneNumber,
            to: $toNumber,
            connection_id: $this->connectionId,
        );

        return [
            'call_control_id' => $response->data->call_control_id,
            'status' => 'initiated',
        ];
    }

    /**
     * Answer an incoming call.
     */
    public function answerCall(string $callControlId): array
    {
        $response = $this->client->calls->actions->answer(
            call_control_id: $callControlId,
        );

        return [
            'call_control_id' => $response->data->call_control_id,
            'status' => 'answered',
        ];
    }

    /**
     * Place a call on hold (pause audio).
     */
    public function holdCall(string $callControlId): array
    {
        $response = $this->client->calls->actions->hold(
            call_control_id: $callControlId,
        );

        return [
            'call_control_id' => $response->data->call_control_id,
            'status' => 'held',
        ];
    }

    /**
     * Resume a held call.
     */
    public function resumeCall(string $callControlId): array
    {
        $response = $this->client->calls->actions->resume(
            call_control_id: $callControlId,
        );

        return [
            'call_control_id' => $response->data->call_control_id,
            'status' => 'resumed',
        ];
    }

    /**
     * Transfer the original caller to the transfer recipient.
     * Both call_control_ids must be provided.
     */
    public function transferCall(string $originalCallId, string $transferCallId): array
    {
        $response = $this->client->calls->actions->transfer(
            call_control_id: $originalCallId,
            transfer_control_id: $transferCallId,
        );

        return [
            'call_control_id' => $response->data->call_control_id,
            'status' => 'transferred',
        ];
    }

    /**
     * Hangup a call.
     */
    public function hangupCall(string $callControlId): array
    {
        $response = $this->client->calls->actions->hangup(
            call_control_id: $callControlId,
        );

        return [
            'call_control_id' => $response->data->call_control_id,
            'status' => 'hung_up',
        ];
    }

    /**
     * Speak text to a call using text-to-speech.
     */
    public function speakToCall(string $callControlId, string $text): array
    {
        $response = $this->client->calls->actions->speak(
            call_control_id: $callControlId,
            payload: $text,
        );

        return [
            'call_control_id' => $response->data->call_control_id,
            'status' => 'speaking',
        ];
    }
}
```

Create a model to track warm transfer state. Generate it with a migration:

```bash
php artisan make:model WarmTransfer -m
```

Edit the migration file `database/migrations/YYYY_MM_DD_HHMMSS_create_warm_transfers_table.php`:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('warm_transfers', function (Blueprint $table) {
            $table->id();
            $table->string('original_call_id')->unique();
            $table->string('transfer_call_id')->nullable();
            $table->string('original_caller')->nullable();
            $table->string('transfer_recipient')->nullable();
            $table->enum('status', ['initiated', 'transfer_dialing', 'transfer_answered', 'transferred', 'failed'])->default('initiated');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('warm_transfers');
    }
};
```

Edit `app/Models/WarmTransfer.php`:

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WarmTransfer extends Model
{
    protected $fillable = [
        'original_call_id',
        'transfer_call_id',
        'original_caller',
        'transfer_recipient',
        'status',
    ];
}
```

Run the migration:

```bash
php artisan migrate
```

Create a controller to handle warm transfer operations. Generate it using Artisan:

```bash
php artisan make:controller WarmTransferController
```

Edit `app/Http/Controllers/WarmTransferController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Models\WarmTransfer;
use App\Services\CallControlService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Exception\ApiException;

class WarmTransferController extends Controller
{
    private CallControlService $callControl;

    public function __construct(CallControlService $callControl)
    {
        $this->callControl = $callControl;
    }

    /**
     * Initiate a warm transfer by dialing the transfer recipient.
     * Expects: { "original_call_id": "...", "transfer_to": "+1555..." }
     */
    public function initiateTransfer(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'original_call_id' => 'required|string',
            'transfer_to' => 'required|string|starts_with:+',
        ]);

        try {
            // Place original caller on hold.
            $this->callControl->holdCall($validated['original_call_id']);

            // Dial the transfer recipient.
            $dialResponse = $this->callControl->initiateCall($validated['transfer_to']);
            $transferCallId = $dialResponse['call_control_id'];

            // Record the transfer state.
            $transfer = WarmTransfer::create([
                'original_call_id' => $validated['original_call_id'],
                'transfer_call_id' => $transferCallId,
                'transfer_recipient' => $validated['transfer_to'],
                'status' => 'transfer_dialing',
            ]);

            return response()->json([
                'transfer_id' => $transfer->id,
                'original_call_id' => $validated['original_call_id'],
                'transfer_call_id' => $transferCallId,
                'status' => 'transfer_dialing',
            ], 200);

        } catch (ApiException $e) {
            return response()->json([
                'error' => 'Failed to initiate transfer',
                'details' => $e->getMessage(),
            ], $e->getHttpStatus() ?? 500);
        }
    }

    /**
     * Complete the warm transfer by bridging the two calls.
     * Expects: { "original_call_id": "...", "transfer_call_id": "..." }
     */
    public function completeTransfer(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'original_call_id' => 'required|string',
            'transfer_call_id' => 'required|string',
        ]);

        try {
            // Transfer the original caller to the transfer recipient.
            $this->callControl->transferCall(
                $validated['original_call_id'],
                $validated['transfer_call_id']
            );

            // Update transfer state.
            WarmTransfer::where('original_call_id', $validated['original_call_id'])
                ->update(['status' => 'transferred']);

            return response()->json([
                'original_call_id' => $validated['original_call_id'],
                'transfer_call_id' => $validated['transfer_call_id'],
                'status' => 'transferred',
            ], 200);

        } catch (ApiException $e) {
            return response()->json([
                'error' => 'Failed to complete transfer',
                'details' => $e->getMessage(),
            ], $e->getHttpStatus() ?? 500);
        }
    }

    /**
     * Cancel a warm transfer and resume the original call.
     * Expects: { "original_call_id": "...", "transfer_call_id": "..." }
     */
    public function cancelTransfer(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'original_call_id' => 'required|string',
            'transfer_call_id' => 'required|string',
        ]);

        try {
            // Hangup the transfer recipient.
            $this->callControl->hangupCall($validated['transfer_call_id']);

            // Resume the original caller.
            $this->callControl->resumeCall($validated['original_call_id']);

            // Update transfer state.
            WarmTransfer::where('original_call_id', $validated['original_call_id'])
                ->update(['status' => 'failed']);

            return response()->json([
                'original_call_id' => $validated['original_call_id'],
                'status' => 'cancelled',
            ], 200);

        } catch (ApiException $e) {
            return response()->json([
                'error' => 'Failed to cancel transfer',
                'details' => $e->getMessage(),
            ], $e->getHttpStatus() ?? 500);
        }
    }
}
```

Create a webhook controller to handle Telnyx call events. Generate it using Artisan:

```bash
php artisan make:controller WebhookController
```

Edit `app/Http/Controllers/WebhookController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Models\WarmTransfer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WebhookController extends Controller
{
    /**
     * Handle incoming Telnyx webhook events.
     * Telnyx sends call.initiated, call.answered, call.hangup, etc.
     */
    public function handleCallEvent(Request $request): JsonResponse
    {
        $event = $request->input('data.event_type');
        $callControlId = $request->input('data.payload.call_control_id');

        // Log the event for debugging.
        \Log::info('Telnyx webhook event', [
            'event' => $event,
            'call_control_id' => $callControlId,
        ]);

        // Handle call.answered event for transfer recipient.
        if ($event === 'call.answered') {
            $transfer = WarmTransfer::where('transfer_call_id', $callControlId)->first();
            if ($transfer) {
                $transfer->update(['status' => 'transfer_answered']);
            }
        }

        // Handle call.hangup to clean up state.
        if ($event === 'call.hangup') {
            WarmTransfer::where('original_call_id', $callControlId)
                ->orWhere('transfer_call_id', $callControlId)
                ->delete();
        }

        return response()->json(['status' => 'received'], 200);
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\WarmTransferController;
use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::post('/warm-transfer/initiate', [WarmTransferController::class, 'initiateTransfer']);
Route::post('/warm-transfer/complete', [WarmTransferController::class, 'completeTransfer']);
Route::post('/warm-transfer/cancel', [WarmTransferController::class, 'cancelTransfer']);

Route::post('/webhooks/call-events', [WebhookController::class, 'handleCallEvent']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Failed to initiate transfer", "details": "Unauthorized"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Laravel development server after updating the `.env` file. |
| Invalid Phone Number Format | You receive a validation error stating "The transfer_to field must start with +". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your request payload to use properly formatted numbers. |
| Webhook Events Not Received | The webhook controller is not being triggered when calls are answered or hung up. | Confirm your Call Control Application webhook URL in the Telnyx Portal points to `https://your-ngrok-url.ngrok.io/api/webhooks/call-events`. Verify ngrok is running and the tunnel is active. Check Laravel logs with `php artisan tail` to see if requests are arriving. Ensure your firewall allows inbound HTTPS traffic on port 443. |
| Transfer Call ID Not Found | The `completeTransfer` endpoint returns an error about the transfer call ID not existing. | Verify that the `transfer_call_id` returned from `initiateTransfer` is being passed correctly to `completeTransfer`. Ensure the transfer recipient has answered the call before attempting to complete the transfer. Check the `warm_transfers` table in your database to confirm the record was created. |
| Database Migration Fails | Running `php artisan migrate` returns an error about the migration file. | Ensure the migration file exists in `database/migrations/` and has the correct timestamp prefix. Run `php artisan migrate:refresh` to reset migrations if needed. Verify your database connection in `.env` is correct (check `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`). |

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

- [Implement an IVR Menu with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/ivr-menu).
- [Record Calls with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/call-recording).
- [Build a Conference Call with PHP](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/php/conference-call).
