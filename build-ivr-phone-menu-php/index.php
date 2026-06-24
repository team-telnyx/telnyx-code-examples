<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Telnyx\Client;
use Telnyx\Exception\ApiErrorException;

class IvrController extends Controller
{
    private Client $client;

    public function __construct()
    {
        $this->client = new Client(apiKey: env('TELNYX_API_KEY'));
    }

    /**
     * Handle inbound call webhook — call.initiated event.
     * Answer the call and play initial prompt.
     */
    public function handleInboundCall(Request $request): JsonResponse
    {
        $payload = $request->all();
        $callControlId = $payload['data']['payload']['call_control_id'] ?? null;

        if (!$callControlId) {
            return response()->json(['error' => 'Missing call_control_id'], 400);
        }

        try {
            // Answer the inbound call
            $this->client->calls->actions->answer(
                $callControlId,
                []
            );

            // Play initial IVR prompt after a brief delay
            $this->client->calls->actions->speak(
                $callControlId,
                [
                    'payload' => 'Welcome to our IVR system. Press 1 for sales, 2 for support, or 3 to repeat this menu.',
                    'language' => 'en-US',
                    'voice' => 'female',
                ]
            );

            return response()->json(['status' => 'call answered and prompt played'], 200);

        } catch (ApiErrorException $e) {
            return response()->json(
                ['error' => 'Failed to answer call: ' . $e->getMessage()],
                $e->getHttpStatus() ?? 500
            );
        }
    }

    /**
     * Handle DTMF input webhook — call.dtmf.received event.
     * Route based on digit pressed.
     */
    public function handleDtmfInput(Request $request): JsonResponse
    {
        $payload = $request->all();
        $callControlId = $payload['data']['payload']['call_control_id'] ?? null;
        $digit = $payload['data']['payload']['digit'] ?? null;

        if (!$callControlId || !$digit) {
            return response()->json(['error' => 'Missing call_control_id or digit'], 400);
        }

        try {
            match ($digit) {
                '1' => $this->routeToSales($callControlId),
                '2' => $this->routeToSupport($callControlId),
                '3' => $this->playMainMenu($callControlId),
                default => $this->playInvalidInput($callControlId),
            };

            return response()->json(['status' => 'DTMF processed', 'digit' => $digit], 200);

        } catch (ApiErrorException $e) {
            return response()->json(
                ['error' => 'Failed to process DTMF: ' . $e->getMessage()],
                $e->getHttpStatus() ?? 500
            );
        }
    }

    /**
     * Route caller to sales department.
     */
    private function routeToSales(string $callControlId): void
    {
        $this->client->calls->actions->speak(
            $callControlId,
            [
                'payload' => 'You have selected sales. Transferring you now.',
                'language' => 'en-US',
                'voice' => 'female',
            ]
        );

        // Transfer to sales number (replace with actual sales number)
        $this->client->calls->actions->transfer(
            $callControlId,
            [
                'to' => '+15551234567',
                'from' => env('TELNYX_PHONE_NUMBER'),
            ]
        );
    }

    /**
     * Route caller to support department.
     */
    private function routeToSupport(string $callControlId): void
    {
        $this->client->calls->actions->speak(
            $callControlId,
            [
                'payload' => 'You have selected support. Transferring you now.',
                'language' => 'en-US',
                'voice' => 'female',
            ]
        );

        // Transfer to support number (replace with actual support number)
        $this->client->calls->actions->transfer(
            $callControlId,
            [
                'to' => '+15559876543',
                'from' => env('TELNYX_PHONE_NUMBER'),
            ]
        );
    }

    /**
     * Replay the main menu.
     */
    private function playMainMenu(string $callControlId): void
    {
        $this->client->calls->actions->speak(
            $callControlId,
            [
                'payload' => 'Welcome to our IVR system. Press 1 for sales, 2 for support, or 3 to repeat this menu.',
                'language' => 'en-US',
                'voice' => 'female',
            ]
        );
    }

    /**
     * Handle invalid DTMF input.
     */
    private function playInvalidInput(string $callControlId): void
    {
        $this->client->calls->actions->speak(
            $callControlId,
            [
                'payload' => 'Invalid selection. Please press 1 for sales, 2 for support, or 3 to repeat this menu.',
                'language' => 'en-US',
                'voice' => 'female',
            ]
        );
    }

    /**
     * Handle call hangup webhook — call.hangup event.
     * Clean up resources and log call completion.
     */
    public function handleCallHangup(Request $request): JsonResponse
    {
        $payload = $request->all();
        $callControlId = $payload['data']['payload']['call_control_id'] ?? null;
        $hangupReason = $payload['data']['payload']['hangup_reason'] ?? 'unknown';

        // Log call completion (implement your logging logic here)
        \Log::info('Call ended', [
            'call_control_id' => $callControlId,
            'reason' => $hangupReason,
        ]);

        return response()->json(['status' => 'call logged'], 200);
    }
}
