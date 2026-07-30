# Build Guide

This example follows the Telnyx DevDocs pattern for Voice API applications:

1. answer an inbound call
2. attach a Telnyx AI Assistant with `ai_assistant_start`
3. let the assistant use a webhook tool to start Pay over Voice
4. handle Pay progress/completed webhooks
5. record a sanitized completion event for the demo dashboard

## Why Pay over Voice

For PCI demos, avoid collecting card data through ordinary speech or DTMF gather endpoints. Pay over Voice is purpose-built for the sensitive step and keeps card data away from the app's conversation, local logs, recordings, and assistant audio.

The demo dashboard is intentionally sanitized. It shows that payment collection entered the PCI-controlled phase without exposing card data.

## Demo Completion

Pay over Voice emits progress and completion webhooks when the IVR flow finishes. The sample also includes `record_secure_payment_complete`, a second assistant tool that writes a PCI-safe completion marker into Conversation Analysis without exposing card details. The app returns `409` from that tool until Telnyx has sent a payment completion event, so the marker cannot be used as proof that payment completed by itself.
