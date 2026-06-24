<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Telnyx\Client;
use Telnyx\Exception\ApiErrorException;

class CallTransferController extends Controller
{
    private Client $client;

    public function __construct()
    {
        // Initialize Telnyx client with API key from environment
        $this->client = new Client(apiKey: env('TELNYX_API_KEY'));
    }

    /**
     * Handle incoming call webhook events.
     * Telnyx sends call.initiated, call.answered, call.hangup, etc. to this endpoint.
     */
    public function handleWebhook(Request $request): JsonResponse
    {
        $payload = $request->all();
        $eventType = $payload['data']['event_type'] ?? null;
        $callControlId = $payload['data']['call_control_id'] ?? null;

        // Log the event for debugging
        \Log::info('Call webhook received', [
            'event_type' => $eventType,
            'call_control_id' => $callControlId,
        ]);

        // Route to appropriate handler based on event type
        match ($eventType) {
            'call.initiated' => $this->handleCallInitiated($payload),
            'call.answered' => $this->handleCallAnswered($payload),
            'call.hangup' => $this->handleCallHangup($payload),
            default => null,
        };

        // Always return 200 OK to acknowledge receipt
        return response()->json(['status' => 'ok'], 200);
    }

    /**
     * Handle call.initiated event — answer the incoming call.
     */
    private function handleCallInitiated(array $payload): void
    {
        $callControlId = $payload['data']['call_control_id'];

        try {
            // Answer the incoming call
            $this->client->calls->actions->answer($callControlId);

            \Log::info('Call answered', ['call_control_id' => $callControlId]);
        } catch (ApiErrorException $e) {
            \Log::error('Failed to answer call', [
                'call_control_id' => $callControlId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Handle call.answered event — initiate transfer to destination number.
     */
    private function handleCallAnswered(array $payload): void
    {
        $callControlId = $payload['data']['call_control_id'];
        $transferNumber = env('TELNYX_TRANSFER_NUMBER');

        try {
            // Transfer the call to the configured destination number
            $this->client->calls->actions->transfer(
                $callControlId,
                to: $transferNumber
            );

            \Log::info('Call transferred', [
                'call_control_id' => $callControlId,
                'transfer_to' => $transferNumber,
            ]);
        } catch (ApiErrorException $e) {
            \Log::error('Failed to transfer call', [
                'call_control_id' => $callControlId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Handle call.hangup event — clean up resources.
     */
    private function handleCallHangup(array $payload): void
    {
        $callControlId = $payload['data']['call_control_id'];
        $hangupReason = $payload['data']['hangup_reason'] ?? 'unknown';

        \Log::info('Call ended', [
            'call_control_id' => $callControlId,
            'reason' => $hangupReason,
        ]);
    }

    /**
     * Endpoint to initiate an outbound call (for testing).
     * POST /api/calls/initiate with JSON body: {"to": "+15559876543"}
     */
    public function initiateCall(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'to' => 'required|string|regex:/^\+\d{10,15}$/',
        ]);

        $toNumber = $validated['to'];
        $fromNumber = env('TELNYX_PHONE_NUMBER');
        $connectionId = env('TELNYX_CONNECTION_ID');

        try {
            // Initiate outbound call
            $response = $this->client->calls->dial(
                from_: $fromNumber,
                to: $toNumber,
                connection_id: $connectionId
            );

            // Extract call_control_id from response — this is returned by the API
            $callControlId = $response->data->call_control_id;

            return response()->json([
                'call_control_id' => $callControlId,
                'from' => $fromNumber,
                'to' => $toNumber,
                'status' => 'initiated',
            ], 201);

        } catch (ApiErrorException $e) {
            \Log::error('Failed to initiate call', [
                'to' => $toNumber,
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'error' => $e->getMessage(),
            ], $e->getHttpStatus() ?? 500);
        }
    }
}
