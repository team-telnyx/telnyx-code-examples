<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class CallWebhookController extends Controller
{
    /**
     * Handle inbound call webhook events from Telnyx.
     * 
     * Telnyx sends webhook events for call.initiated, call.answered, call.hangup, etc.
     * This handler logs the event and responds with 200 OK to acknowledge receipt.
     */
    public function handleInboundCall(Request $request): JsonResponse
    {
        // Extract the webhook payload
        $payload = $request->all();
        
        // Validate required fields
        if (!isset($payload['data']) || !isset($payload['data']['event_type'])) {
            return response()->json(['error' => 'Invalid webhook payload'], 400);
        }
        
        $eventType = $payload['data']['event_type'];
        $callData = $payload['data'];
        
        // Log the event for debugging and audit trails
        \Log::info('Inbound call webhook received', [
            'event_type' => $eventType,
            'call_control_id' => $callData['call_control_id'] ?? null,
            'from' => $callData['from'] ?? null,
            'to' => $callData['to'] ?? null,
        ]);
        
        // Handle different call events
        switch ($eventType) {
            case 'call.initiated':
                $this->handleCallInitiated($callData);
                break;
            case 'call.answered':
                $this->handleCallAnswered($callData);
                break;
            case 'call.hangup':
                $this->handleCallHangup($callData);
                break;
            case 'call.dtmf.received':
                $this->handleDTMFReceived($callData);
                break;
            default:
                \Log::warning('Unknown call event type', ['event_type' => $eventType]);
        }
        
        // Always return 200 OK to acknowledge webhook receipt
        return response()->json(['status' => 'received'], 200);
    }
    
    /**
     * Handle call.initiated event — inbound call has started.
     */
    private function handleCallInitiated(array $callData): void
    {
        $callControlId = $callData['call_control_id'] ?? null;
        $from = $callData['from'] ?? 'unknown';
        $to = $callData['to'] ?? 'unknown';
        
        \Log::info('Call initiated', [
            'call_control_id' => $callControlId,
            'from' => $from,
            'to' => $to,
        ]);
        
        // Store call metadata in cache or database for later retrieval
        if ($callControlId) {
            cache()->put("call:{$callControlId}", [
                'from' => $from,
                'to' => $to,
                'initiated_at' => now(),
                'status' => 'initiated',
            ], now()->addHours(1));
        }
    }
    
    /**
     * Handle call.answered event — inbound call has been answered.
     */
    private function handleCallAnswered(array $callData): void
    {
        $callControlId = $callData['call_control_id'] ?? null;
        
        \Log::info('Call answered', ['call_control_id' => $callControlId]);
        
        if ($callControlId) {
            $callInfo = cache()->get("call:{$callControlId}", []);
            $callInfo['status'] = 'answered';
            $callInfo['answered_at'] = now();
            cache()->put("call:{$callControlId}", $callInfo, now()->addHours(1));
        }
    }
    
    /**
     * Handle call.hangup event — inbound call has ended.
     */
    private function handleCallHangup(array $callData): void
    {
        $callControlId = $callData['call_control_id'] ?? null;
        $hangupReason = $callData['hangup_reason'] ?? 'unknown';
        
        \Log::info('Call hangup', [
            'call_control_id' => $callControlId,
            'hangup_reason' => $hangupReason,
        ]);
        
        if ($callControlId) {
            $callInfo = cache()->get("call:{$callControlId}", []);
            $callInfo['status'] = 'hangup';
            $callInfo['hangup_reason'] = $hangupReason;
            $callInfo['hangup_at'] = now();
            cache()->put("call:{$callControlId}", $callInfo, now()->addHours(1));
        }
    }
    
    /**
     * Handle call.dtmf.received event — DTMF digit collected during call.
     */
    private function handleDTMFReceived(array $callData): void
    {
        $callControlId = $callData['call_control_id'] ?? null;
        $digit = $callData['dtmf_digit'] ?? null;
        
        \Log::info('DTMF received', [
            'call_control_id' => $callControlId,
            'digit' => $digit,
        ]);
    }
    
    /**
     * Retrieve call status from cache.
     * 
     * This endpoint allows you to query the status of a previously initiated call.
     */
    public function getCallStatus(Request $request): JsonResponse
    {
        $callControlId = $request->query('call_control_id');
        
        if (!$callControlId) {
            return response()->json(['error' => 'call_control_id query parameter required'], 400);
        }
        
        $callInfo = cache()->get("call:{$callControlId}");
        
        if (!$callInfo) {
            return response()->json(['error' => 'Call not found'], 404);
        }
        
        return response()->json($callInfo, 200);
    }
}
