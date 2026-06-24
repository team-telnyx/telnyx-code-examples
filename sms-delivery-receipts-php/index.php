<?php

// app/Http/Controllers/SmsController.php

namespace App\Http\Controllers;

use App\Models\SmsMessage;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Telnyx\Client;

class SmsController extends Controller
{
    private Client $client;

    public function __construct()
    {
        // Initialize Telnyx client with API key from environment
        $this->client = new Client(apiKey: getenv('TELNYX_API_KEY'));
    }

    /**
     * Send an SMS message and store it in the database.
     */
    public function send(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'to' => 'required|string|regex:/^\+\d{1,15}$/',
            'message' => 'required|string|max:1600',
        ]);

        $fromNumber = getenv('TELNYX_PHONE_NUMBER');
        if (!$fromNumber) {
            return response()->json(['error' => 'TELNYX_PHONE_NUMBER not configured'], 500);
        }

        try {
            // Create message via Telnyx API
            $response = $this->client->messages->create([
                'from_' => $fromNumber,
                'to' => $validated['to'],
                'text' => $validated['message'],
            ]);

            // Store message record in database
            $smsMessage = SmsMessage::create([
                'message_id' => $response->data->id,
                'from_number' => $fromNumber,
                'to_number' => $validated['to'],
                'text' => $validated['message'],
                'direction' => 'outbound',
                'status' => 'queued',
            ]);

            return response()->json([
                'id' => $smsMessage->id,
                'message_id' => $smsMessage->message_id,
                'status' => $smsMessage->status,
                'to' => $smsMessage->to_number,
            ], 201);

        } catch (\Telnyx\AuthenticationError $e) {
            return response()->json(['error' => 'Invalid API key'], 401);
        } catch (\Telnyx\RateLimitError $e) {
            return response()->json(['error' => 'Rate limit exceeded'], 429);
        } catch (\Telnyx\APIStatusError $e) {
            return response()->json(['error' => $e->getMessage()], $e->status_code ?? 400);
        } catch (\Telnyx\APIConnectionError $e) {
            return response()->json(['error' => 'Network error connecting to Telnyx'], 503);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        }
    }

    /**
     * Handle incoming webhook events from Telnyx.
     * Processes message.finalized events to update delivery status.
     */
    public function webhook(Request $request): JsonResponse
    {
        $payload = $request->all();

        // Validate webhook signature (optional but recommended for production)
        // Telnyx sends X-Telnyx-Signature-ED25519 header for verification

        $eventType = $payload['data']['event_type'] ?? null;
        $messageId = $payload['data']['payload']['id'] ?? null;

        if (!$messageId) {
            return response()->json(['error' => 'Invalid webhook payload'], 400);
        }

        try {
            // Handle message.finalized events (delivery status updates)
            if ($eventType === 'message.finalized') {
                $this->handleMessageFinalized($payload['data']['payload']);
            }

            // Return 200 OK to acknowledge receipt
            return response()->json(['status' => 'received'], 200);

        } catch (\Exception $e) {
            // Log error but still return 200 to prevent Telnyx retries
            \Log::error('Webhook processing error: ' . $e->getMessage());
            return response()->json(['status' => 'received'], 200);
        }
    }

    /**
     * Process message.finalized webhook event.
     * Updates the SMS message record with final delivery status.
     */
    private function handleMessageFinalized(array $payload): void
    {
        $messageId = $payload['id'] ?? null;
        if (!$messageId) {
            return;
        }

        $smsMessage = SmsMessage::where('message_id', $messageId)->first();
        if (!$smsMessage) {
            return;
        }

        // Extract delivery status from the first recipient
        $recipients = $payload['to'] ?? [];
        if (!empty($recipients)) {
            $recipient = $recipients[0];
            $status = $recipient['status'] ?? 'unknown';
            $smsMessage->status = $status;

            // Update delivered_at timestamp if message was delivered
            if ($status === 'delivered') {
                $smsMessage->delivered_at = now();
            }

            // Store error message if delivery failed
            if ($status === 'failed' && isset($recipient['error'])) {
                $smsMessage->error_message = $recipient['error']['message'] ?? 'Unknown error';
            }

            $smsMessage->save();
        }
    }

    /**
     * Retrieve delivery status for a specific message.
     */
    public function status(string $messageId): JsonResponse
    {
        $smsMessage = SmsMessage::where('message_id', $messageId)->first();

        if (!$smsMessage) {
            return response()->json(['error' => 'Message not found'], 404);
        }

        return response()->json([
            'id' => $smsMessage->id,
            'message_id' => $smsMessage->message_id,
            'to' => $smsMessage->to_number,
            'status' => $smsMessage->status,
            'sent_at' => $smsMessage->sent_at,
            'delivered_at' => $smsMessage->delivered_at,
            'error_message' => $smsMessage->error_message,
        ]);
    }

    /**
     * List all messages with optional status filter.
     */
    public function list(Request $request): JsonResponse
    {
        $query = SmsMessage::query();

        if ($request->has('status')) {
            $query->where('status', $request->input('status'));
        }

        if ($request->has('direction')) {
            $query->where('direction', $request->input('direction'));
        }

        $messages = $query->orderBy('created_at', 'desc')
            ->paginate(20);

        return response()->json([
            'data' => $messages->map(fn($msg) => [
                'id' => $msg->id,
                'message_id' => $msg->message_id,
                'to' => $msg->to_number,
                'status' => $msg->status,
                'sent_at' => $msg->sent_at,
                'delivered_at' => $msg->delivered_at,
            ]),
            'pagination' => [
                'total' => $messages->total(),
                'per_page' => $messages->perPage(),
                'current_page' => $messages->currentPage(),
            ],
        ]);
    }
}
