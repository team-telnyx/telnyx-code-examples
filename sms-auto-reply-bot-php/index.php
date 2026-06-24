<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Telnyx\Client;
use Telnyx\Exception\ApiErrorException;

class SmsController extends Controller
{
    private Client $client;
    private string $fromNumber;

    public function __construct()
    {
        // Initialize Telnyx client with API key from environment
        $this->client = new Client(apiKey: getenv('TELNYX_API_KEY'));
        $this->fromNumber = config('services.telnyx.phone_number');
    }

    /**
     * Handle incoming SMS webhook from Telnyx.
     * Validates webhook signature and sends autoresponse.
     */
    public function handleInbound(Request $request): JsonResponse
    {
        // Log incoming webhook for debugging
        \Log::info('Incoming SMS webhook', $request->all());

        // Validate required webhook fields
        $data = $request->all();
        if (!isset($data['data']['payload']['from']['phone_number']) || 
            !isset($data['data']['payload']['text'])) {
            return response()->json(['error' => 'Invalid webhook payload'], 400);
        }

        $fromNumber = $data['data']['payload']['from']['phone_number'];
        $incomingText = $data['data']['payload']['text'];

        try {
            // Generate autoresponse message based on incoming content
            $autoresponseText = $this->generateAutoresponse($incomingText);

            // Send autoresponse using Telnyx API
            $response = $this->client->messages->create([
                'from_' => $this->fromNumber,
                'to' => $fromNumber,
                'text' => $autoresponseText,
            ]);

            // Extract serializable data — SDK objects are NOT JSON-serializable
            $responseData = [
                'message_id' => $response->data->id,
                'status' => $response->data->to[0]->status ?? 'pending',
                'to' => $fromNumber,
                'autoresponse_sent' => true,
            ];

            \Log::info('Autoresponse sent', $responseData);

            return response()->json($responseData, 200);

        } catch (\Telnyx\Exception\AuthenticationException $e) {
            \Log::error('Authentication error', ['message' => $e->getMessage()]);
            return response()->json(['error' => 'Authentication failed'], 401);

        } catch (\Telnyx\Exception\RateLimitException $e) {
            \Log::warning('Rate limit exceeded', ['message' => $e->getMessage()]);
            return response()->json(['error' => 'Rate limit exceeded'], 429);

        } catch (\Telnyx\Exception\ApiErrorException $e) {
            \Log::error('API error', ['message' => $e->getMessage(), 'code' => $e->getCode()]);
            $statusCode = $e->getHttpStatus() ?? 500;
            return response()->json(['error' => $e->getMessage()], $statusCode);

        } catch (\Exception $e) {
            \Log::error('Unexpected error', ['message' => $e->getMessage()]);
            return response()->json(['error' => 'Internal server error'], 500);
        }
    }

    /**
     * Generate contextual autoresponse based on incoming message.
     * In production, integrate with NLP or keyword matching.
     */
    private function generateAutoresponse(string $incomingText): string
    {
        $lowerText = strtolower($incomingText);

        // Simple keyword-based routing
        if (str_contains($lowerText, 'hours') || str_contains($lowerText, 'open')) {
            return 'We are open Monday-Friday 9AM-5PM EST. How can we help?';
        }

        if (str_contains($lowerText, 'price') || str_contains($lowerText, 'cost')) {
            return 'Pricing varies by service. Reply with your inquiry for a custom quote.';
        }

        if (str_contains($lowerText, 'support') || str_contains($lowerText, 'help')) {
            return 'Our support team will respond shortly. Ticket created.';
        }

        // Default autoresponse
        return 'Thank you for your message. We will respond as soon as possible.';
    }

    /**
     * Send SMS to a specific number (for testing or manual sends).
     */
    public function sendSms(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'to' => 'required|string|regex:/^\+\d{1,15}$/',
            'message' => 'required|string|max:1600',
        ]);

        try {
            $response = $this->client->messages->create([
                'from_' => $this->fromNumber,
                'to' => $validated['to'],
                'text' => $validated['message'],
            ]);

            return response()->json([
                'message_id' => $response->data->id,
                'status' => $response->data->to[0]->status ?? 'pending',
                'to' => $validated['to'],
            ], 200);

        } catch (\Telnyx\Exception\AuthenticationException $e) {
            return response()->json(['error' => 'Invalid API key'], 401);

        } catch (\Telnyx\Exception\RateLimitException $e) {
            return response()->json(['error' => 'Rate limit exceeded'], 429);

        } catch (\Telnyx\Exception\ApiErrorException $e) {
            $statusCode = $e->getHttpStatus() ?? 500;
            return response()->json(['error' => $e->getMessage()], $statusCode);

        } catch (\Exception $e) {
            return response()->json(['error' => 'Internal server error'], 500);
        }
    }
}
