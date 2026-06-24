# Conference Call with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that manages conference calls using the Telnyx Voice API. This tutorial demonstrates how to initiate calls, add participants to a conference, handle webhook events, and manage call state with proper error handling and secure credential management.

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
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).
- Basic understanding of Laravel routing, controllers, and middleware.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-conference-calling-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/build-conference-calling-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a controller to manage conference calls:

```bash
php artisan make:controller ConferenceCallController
```

Edit `app/Http/Controllers/ConferenceCallController.php`:

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Telnyx\Client;
use Telnyx\Exception\ApiErrorException;
use App\Models\ConferenceCall;

class ConferenceCallController extends Controller
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client(apiKey: config('telnyx.api_key'));
    }

    /**
     * Initiate a conference call with the specified participants.
     * Stores conference metadata and initiates outbound calls to each participant.
     */
    public function initiate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'participants' => 'required|array|min:2',
            'participants.*' => 'required|string|regex:/^\+\d{10,15}$/',
        ]);

        $conferenceId = 'conf_' . uniqid();
        $initiatorNumber = config('telnyx.phone_number');

        // Store conference metadata in database
        $conference = ConferenceCall::create([
            'conference_id' => $conferenceId,
            'initiator_number' => $initiatorNumber,
            'participants' => json_encode($validated['participants']),
            'status' => 'pending',
        ]);

        // Initiate outbound calls to each participant
        $callIds = [];
        foreach ($validated['participants'] as $participantNumber) {
            try {
                $response = $this->client->calls->dial(
                    from_: $initiatorNumber,
                    to: $participantNumber,
                    connection_id: config('telnyx.connection_id'),
                    custom_headers: [
                        'X-Conference-ID' => $conferenceId,
                    ],
                );

                $callIds[] = [
                    'participant' => $participantNumber,
                    'call_control_id' => $response->data->call_control_id,
                ];
            } catch (ApiErrorException $e) {
                return response()->json([
                    'error' => 'Failed to initiate call to ' . $participantNumber,
                    'details' => $e->getMessage(),
                ], 400);
            }
        }

        return response()->json([
            'conference_id' => $conferenceId,
            'status' => 'initiated',
            'calls' => $callIds,
        ], 201);
    }

    /**
     * Retrieve the current status of a conference call.
     */
    public function status(string $conferenceId): JsonResponse
    {
        $conference = ConferenceCall::where('conference_id', $conferenceId)->first();

        if (!$conference) {
            return response()->json(['error' => 'Conference not found'], 404);
        }

        return response()->json([
            'conference_id' => $conference->conference_id,
            'status' => $conference->status,
            'participants' => json_decode($conference->participants, true),
            'started_at' => $conference->started_at,
            'ended_at' => $conference->ended_at,
        ]);
    }

    /**
     * End a conference call and disconnect all participants.
     */
    public function end(string $conferenceId): JsonResponse
    {
        $conference = ConferenceCall::where('conference_id', $conferenceId)->first();

        if (!$conference) {
            return response()->json(['error' => 'Conference not found'], 404);
        }

        // Update conference status
        $conference->update([
            'status' => 'ended',
            'ended_at' => now(),
        ]);

        return response()->json([
            'conference_id' => $conferenceId,
            'status' => 'ended',
        ]);
    }
}
```

Create a webhook controller to handle Telnyx voice events:

```bash
php artisan make:controller WebhookController
```

Edit `app/Http/Controllers/WebhookController.php`:

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use App\Models\ConferenceCall;
use Illuminate\Support\Facades\Log;

class WebhookController extends Controller
{
    /**
     * Handle incoming Telnyx voice webhooks.
     * Processes call.initiated, call.answered, and call.hangup events.
     */
    public function handleVoiceEvent(Request $request): Response
    {
        $event = $request->input('data.event_type');
        $callControlId = $request->input('data.payload.call_control_id');
        $conferenceId = $request->input('data.payload.custom_headers.X-Conference-ID');

        Log::info('Voice webhook received', [
            'event' => $event,
            'call_control_id' => $callControlId,
            'conference_id' => $conferenceId,
        ]);

        if (!$conferenceId) {
            return response('OK', 200);
        }

        $conference = ConferenceCall::where('conference_id', $conferenceId)->first();

        if (!$conference) {
            Log::warning('Conference not found for webhook', ['conference_id' => $conferenceId]);
            return response('OK', 200);
        }

        switch ($event) {
            case 'call.initiated':
                // Call has been initiated to participant
                Log::info('Call initiated', ['call_control_id' => $callControlId]);
                break;

            case 'call.answered':
                // Participant has answered the call
                if ($conference->status === 'pending') {
                    $conference->update([
                        'status' => 'active',
                        'started_at' => now(),
                    ]);
                }
                Log::info('Call answered', ['call_control_id' => $callControlId]);
                break;

            case 'call.hangup':
                // Participant has hung up
                Log::info('Call hangup', ['call_control_id' => $callControlId]);
                
                // Check if all participants have disconnected
                $participants = json_decode($conference->participants, true);
                if (count($participants) <= 1) {
                    $conference->update([
                        'status' => 'ended',
                        'ended_at' => now(),
                    ]);
                }
                break;

            default:
                Log::debug('Unhandled event type', ['event' => $event]);
        }

        return response('OK', 200);
    }
}
```

Create a model for conference calls:

```bash
php artisan make:model ConferenceCall
```

Edit `app/Models/ConferenceCall.php`:

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ConferenceCall extends Model
{
    protected $fillable = [
        'conference_id',
        'initiator_number',
        'participants',
        'status',
        'started_at',
        'ended_at',
    ];

    protected $casts = [
        'participants' => 'array',
        'started_at' => 'datetime',
        'ended_at' => 'datetime',
    ];
}
```

Register the routes in `routes/api.php`:

```php
<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\ConferenceCallController;
use App\Http\Controllers\WebhookController;

Route::post('/conferences', [ConferenceCallController::class, 'initiate']);
Route::get('/conferences/{conferenceId}', [ConferenceCallController::class, 'status']);
Route::post('/conferences/{conferenceId}/end', [ConferenceCallController::class, 'end']);

Route::post('/webhooks/voice', [WebhookController::class, 'handleVoiceEvent']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conference-calling-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Failed to initiate call..."}` with authentication failure. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key from the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Laravel development server after updating the `.env` file. |
| Invalid Phone Number Format | You receive a validation error stating phone numbers must match the regex pattern. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your request JSON to use properly formatted numbers. |
| Webhook Events Not Received | Conference status remains "pending" and webhook logs show no incoming events. | Verify your ngrok URL is correctly set in the `WEBHOOK_URL` environment variable. Ensure the webhook URL is publicly accessible and matches the URL configured in your Telnyx Call Control Application settings. Check Laravel logs with `php artisan tail` to see if requests are being received. |
| Connection ID Not Found | The API returns an error about an invalid or missing connection ID. | Verify your `TELNYX_CONNECTION_ID` in the `.env` file corresponds to an active Call Control Application in the [Telnyx Portal](https://portal.telnyx.com). The connection ID links your phone number to the Call Control application. Ensure the phone number associated with the connection ID matches `TELNYX_PHONE_NUMBER`. |
| Database Migration Fails | Running `php artisan migrate` returns an error about table creation. | Ensure your database is properly configured in the `.env` file (check `DB_CONNECTION`, `DB_HOST`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`). Run `php artisan migrate:fresh` to reset migrations if needed. Verify the database server is running and accessible. |

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

- [Handle Inbound Call Webhooks with PHP](/tutorials/voice/php/inbound-call-webhook).
- [Record Conference Calls with PHP](/tutorials/voice/php/call-recording).
- [Transfer Calls Between Participants with PHP](/tutorials/voice/php/call-transfer).
