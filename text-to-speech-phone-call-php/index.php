<?php

namespace App\Http\Controllers;

use Telnyx\Client;
use Telnyx\Exception\ApiErrorException;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class CallController extends Controller
{
    private Client $client;

    public function __construct()
    {
        // Initialize Telnyx client with API key from environment
        $this->client = new Client(apiKey: getenv('TELNYX_API_KEY'));
    }

    /**
     * Initiate an outbound call with text-to-speech.
     * 
     * @param Request $request
     * @return JsonResponse
     */
    public function initiateCall(Request $request): JsonResponse
    {
        // Validate incoming request
        $validated = $request->validate([
            'to' => 'required|string|regex:/^\+\d{1,15}$/',
            'message' => 'required|string|max:1000',
        ]);

        $toNumber = $validated['to'];
        $message = $validated['message'];
        $fromNumber = config('services.telnyx.phone_number');
        $connectionId = config('services.telnyx.connection_id');

        if (!$fromNumber || !$connectionId) {
            return response()->json([
                'error' => 'Missing required configuration: TELNYX_PHONE_NUMBER or TELNYX_CONNECTION_ID',
            ], 500);
        }

        try {
            // Initiate the outbound call
            $response = $this->client->calls->dial(
                from_: $fromNumber,
                to: $toNumber,
                connection_id: $connectionId,
            );

            // Extract call_control_id from response for future control actions
            $callControlId = $response->data->call_control_id;

            // Store call metadata in session or database for webhook handling
            session(['call_' . $callControlId => [
                'to' => $toNumber,
                'message' => $message,
                'initiated_at' => now(),
            ]]);

            return response()->json([
                'call_control_id' => $callControlId,
                'status' => 'initiated',
                'to' => $toNumber,
            ], 200);

        } catch (\Exception $e) {
            return $this->handleException($e);
        }
    }

    /**
     * Handle webhook events from Telnyx (call.answered, call.hangup, etc.).
     * 
     * @param Request $request
     * @return JsonResponse
     */
    public function handleWebhook(Request $request): JsonResponse
    {
        $payload = $request->all();
        $eventType = $payload['data']['event_type'] ?? null;
        $callControlId = $payload['data']['call_control_id'] ?? null;

        if (!$eventType || !$callControlId) {
            return response()->json(['error' => 'Invalid webhook payload'], 400);
        }

        try {
            // Retrieve stored call metadata
            $callData = session('call_' . $callControlId, []);
            $message = $callData['message'] ?? 'Hello, this is a test message.';

            switch ($eventType) {
                case 'call.answered':
                    // Call was answered — play TTS message
                    $this->playTTS($callControlId, $message);
                    break;

                case 'call.speak.ended':
                    // TTS playback finished — hang up the call
                    $this->hangupCall($callControlId);
                    break;

                case 'call.hangup':
                    // Call ended — clean up session data
                    session()->forget('call_' . $callControlId);
                    break;

                default:
                    // Log other events for debugging
                    \Log::info('Unhandled webhook event', ['event_type' => $eventType]);
            }

            return response()->json(['status' => 'received'], 200);

        } catch (\Exception $e) {
            \Log::error('Webhook processing error', ['error' => $e->getMessage()]);
            return response()->json(['error' => 'Webhook processing failed'], 500);
        }
    }

    /**
     * Play text-to-speech message on an active call.
     * 
     * @param string $callControlId
     * @param string $message
     * @return void
     */
    private function playTTS(string $callControlId, string $message): void
    {
        try {
            $this->client->calls->actions->speak(
                call_control_id: $callControlId,
                payload: [
                    'text' => $message,
                    'language' => 'en-US',
                    'voice' => 'female',
                ],
            );
        } catch (\Exception $e) {
            \Log::error('TTS playback failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Hang up an active call.
     * 
     * @param string $callControlId
     * @return void
     */
    private function hangupCall(string $callControlId): void
    {
        try {
            $this->client->calls->actions->hangup(
                call_control_id: $callControlId,
            );
        } catch (\Exception $e) {
            \Log::error('Hangup failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Handle Telnyx API exceptions and return appropriate HTTP responses.
     * 
     * @param \Exception $e
     * @return JsonResponse
     */
    private function handleException(\Exception $e): JsonResponse
    {
        if ($e instanceof \Telnyx\Exception\AuthenticationException) {
            return response()->json(['error' => 'Invalid API key'], 401);
        }

        if ($e instanceof \Telnyx\Exception\RateLimitException) {
            return response()->json(['error' => 'Rate limit exceeded. Please slow down.'], 429);
        }

        if ($e instanceof ApiErrorException) {
            return response()->json([
                'error' => $e->getMessage(),
                'status_code' => $e->getHttpStatus(),
            ], $e->getHttpStatus() ?? 400);
        }

        if ($e instanceof \Telnyx\Exception\ApiConnectionException) {
            return response()->json(['error' => 'Network error connecting to Telnyx'], 503);
        }

        return response()->json(['error' => 'An unexpected error occurred'], 500);
    }
}
