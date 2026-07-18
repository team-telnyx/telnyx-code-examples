# Telnyx Code Examples - AI Communications Infrastructure

Production-ready code examples for the Telnyx platform. Each example is a self-contained project with working code, documentation, and environment configuration - clone, configure, and run in minutes.

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples

# 2. Pick an example
cd send-sms-python

# 3. Configure and run (see each example's README for language-specific commands)
cp .env.example .env
# Edit .env with your Telnyx API key from https://portal.telnyx.com
pip install -r requirements.txt && python app.py
```

> Full API reference at [developers.telnyx.com](https://developers.telnyx.com)

Each example's README has a Quick Start with the exact install/run commands for its language, an `API.md` typed endpoint reference, and a `GUIDE.md` walkthrough.

---

<details open>
<summary><h2>Voice AI</h2> <em>(146 examples)</em></summary>

Build voice applications with [Telnyx Voice AI](https://telnyx.com/products/voice-ai-agents) - IVR menus, call recording, conferencing, WebRTC, and AI-powered call routing.

| Example | Language | Description |
|---------|----------|-------------|
| [branded-caller-id-manager-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/branded-caller-id-manager-python/README.md) | Python | Branded Caller ID Manager - register, manage, and verify branded calling profiles with STIR/SHAKEN attestation for higher answer rates. |
| [build-conference-calling-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conference-calling-go/README.md) | Go | --- |
| [build-conference-calling-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conference-calling-nodejs/README.md) | Node.js | --- |
| [build-conference-calling-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conference-calling-php/README.md) | PHP | --- |
| [build-conference-calling-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conference-calling-python/README.md) | Python | Create multi-party conference calls. |
| [build-conference-calling-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conference-calling-ruby/README.md) | Ruby | --- |
| [build-conversational-workflow-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-conversational-workflow-nodejs/README.md) | Node.js | Build a Telnyx Conversational Workflow for inbound auto insurance claim intake with structured branches, backend tools, and priority follow-up. |
| [build-ivr-phone-menu-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-csharp/README.md) | C# | --- |
| [build-ivr-phone-menu-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-go/README.md) | Go | --- |
| [build-ivr-phone-menu-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-nodejs/README.md) | Node.js | Production-ready IVR system using the Telnyx Voice API and Express.js. Answers inbound calls, plays a menu via TTS, collects DTMF input, and routes callers to sales or support. |
| [build-ivr-phone-menu-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-php/README.md) | PHP | --- |
| [build-ivr-phone-menu-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-python/README.md) | Python | Build an interactive voice response menu with DTMF input. |
| [build-ivr-phone-menu-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-ivr-phone-menu-ruby/README.md) | Ruby | --- |
| [bulk-number-validation-cleaner-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/bulk-number-validation-cleaner-python/README.md) | Python | Bulk Number Validation & Cleaner - validate and clean phone number lists via Telnyx Number Lookup API. |
| [call-analytics-dashboard-api-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-analytics-dashboard-api-python/README.md) | Python | Pull call detail records from the Telnyx API and expose call usage analytics through a dashboard API. |
| [call-compliance-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-compliance-go/README.md) | Go | --- |
| [call-compliance-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-compliance-python/README.md) | Python | --- |
| [call-compliance-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-compliance-ruby/README.md) | Ruby | --- |
| [call-forwarding-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-forwarding-csharp/README.md) | C# | --- |
| [call-forwarding-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-forwarding-go/README.md) | Go | --- |
| [call-forwarding-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-forwarding-java/README.md) | Java | --- |
| [call-forwarding-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-forwarding-nodejs/README.md) | Node.js | --- |
| [call-forwarding-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-forwarding-php/README.md) | PHP | --- |
| [call-forwarding-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-forwarding-python/README.md) | Python | Forward incoming calls to another destination. |
| [call-forwarding-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-forwarding-ruby/README.md) | Ruby | --- |
| [call-queue-with-hold-music-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-queue-with-hold-music-python/README.md) | Python | Call Queue with Hold Music - queue callers with position announcements and hold music, route to agents. |
| [call-sentiment-live-escalation-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-sentiment-live-escalation-python/README.md) | Python | Call Sentiment Live Escalation - monitor call transcripts in real-time. When negative sentiment or distress is detected, auto-escalate to a supervisor. |
| [call-whisper-monitoring-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-whisper-monitoring-csharp/README.md) | C# | --- |
| [call-whisper-monitoring-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-whisper-monitoring-go/README.md) | Go | --- |
| [call-whisper-monitoring-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-whisper-monitoring-java/README.md) | Java | --- |
| [call-whisper-monitoring-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-whisper-monitoring-nodejs/README.md) | Node.js | --- |
| [call-whisper-monitoring-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-whisper-monitoring-php/README.md) | PHP | --- |
| [call-whisper-monitoring-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-whisper-monitoring-python/README.md) | Python | Monitor calls with whisper prompts for agents. |
| [call-whisper-monitoring-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-whisper-monitoring-ruby/README.md) | Ruby | --- |
| [call-whisper-screen-pop-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-whisper-screen-pop-python/README.md) | Python | Call Whisper & Screen Pop - whisper caller info to agent before connecting the call. |
| [cloud-storage-call-archive-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/cloud-storage-call-archive-python/README.md) | Python | Cloud Storage Call Archive - archive call recordings to Telnyx Cloud Storage (S3-compatible) with searchable metadata. |
| [cnam-caller-id-lookup-enrichment-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/cnam-caller-id-lookup-enrichment-python/README.md) | Python | CNAM Caller ID Lookup Enrichment - look up CNAM for inbound callers, enrich CRM records with caller identity. |
| [commercial-voiceover-generator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/commercial-voiceover-generator-python/README.md) | Python | Provide product name, target audience, and tone. AI writes 3 script variations with timing marks, TTS renders each in multiple voices, delivers top picks via SMS for client approval. |
| [conference-live-poll-dtmf-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/conference-live-poll-dtmf-python/README.md) | Python | Conference Live Poll via DTMF - host asks a question, all conference participants vote by pressing 1-4, results tallied instantly. |
| [conversation-relay-voice-bot-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/conversation-relay-voice-bot-python/README.md) | Python | Forward live phone calls to any existing text-in/text-out AI chatbot using Telnyx Conversation Relay — no changes to the bot. |
| [deepfake-voice-detector-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/deepfake-voice-detector-python/README.md) | Python | Real-time synthetic speech detection on live phone calls. Captures audio via media streaming, extracts acoustic features, scores deepfake probability with AI Inference, alerts security team via Slack. |
| [edge-ai-assistant-backend-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-ai-assistant-backend-go/README.md) | Go | Use a Telnyx Edge Compute function as the backend for AI Assistant dynamic variables and webhook tool calls — no separate server required. |
| [edge-compliance-monitor-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-compliance-monitor-python/README.md) | Python | Real-time compliance checking for regulated call centers using Telnyx Voice, AI Inference, and Edge Compute. |
| [edge-fraud-firewall-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-fraud-firewall-python/README.md) | Python | Screen every inbound call at the edge with Telnyx Voice, Number Lookup, and AI Inference. |
| [edge-geo-smart-router-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-geo-smart-router-python/README.md) | Python | Route calls by geography at the edge using Telnyx Voice, AI Inference, and Edge Compute. |
| [edge-ivr-ab-tester-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-ivr-ab-tester-python/README.md) | Python | A/B test different IVR flows at the edge. |
| [edge-merge-ai-receptionist-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-merge-ai-receptionist-python/README.md) | Python | Edge worker answers every call using Telnyx Voice, AI Inference, and Edge Compute with Merge HRIS. |
| [edge-merge-reference-checker-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-merge-reference-checker-python/README.md) | Python | Automate reference checks when an ATS application advances using Telnyx Voice and AI Inference with Merge ATS. |
| [edge-merge-shift-coverage-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-merge-shift-coverage-python/README.md) | Python | Manager texts need a closer tonight using Telnyx Messaging and Edge Compute with Merge HRIS. |
| [edge-number-masking-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-number-masking-python/README.md) | Python | Marketplace-style proxy number pool at the edge. |
| [edge-voicemail-to-action-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-voicemail-to-action-python/README.md) | Python | AI-powered voicemail triage at the edge. |
| [edge-webhook-aggregator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-webhook-aggregator-python/README.md) | Python | Multi-tenant webhook consolidation at the edge. |
| [fax-to-structured-data-pipeline-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/fax-to-structured-data-pipeline-python/README.md) | Python | Fax-to-Structured-Data Pipeline - receive faxes, AI extracts structured data (invoices, orders, prescriptions) into JSON. |
| [hold-music-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hold-music-csharp/README.md) | C# | --- |
| [hold-music-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hold-music-go/README.md) | Go | --- |
| [hold-music-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hold-music-java/README.md) | Java | --- |
| [hold-music-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hold-music-nodejs/README.md) | Node.js | --- |
| [hold-music-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hold-music-php/README.md) | PHP | --- |
| [hold-music-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hold-music-python/README.md) | Python | --- |
| [hold-music-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hold-music-ruby/README.md) | Ruby | --- |
| [hotel-guest-services-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hotel-guest-services-python/README.md) | Python | Inbound voice and SMS guest services for hotels. Voice calls are handled by a Telnyx AI Assistant, while SMS requests are categorized and tracked by the Flask app. |
| [live-podcast-call-in-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/live-podcast-call-in-python/README.md) | Python | Hosts on a conference call, listeners call in. AI screens callers via STT, queues approved ones, generates real-time fact-checks for the host, TTS announces topics. |
| [make-outbound-phone-call-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-csharp/README.md) | C# | Place an outbound phone call with the Telnyx Call Control API using C# and ASP.NET. |
| [make-outbound-phone-call-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-go/README.md) | Go | --- |
| [make-outbound-phone-call-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-java/README.md) | Java | Place an outbound phone call with the Telnyx Call Control API using Java. |
| [make-outbound-phone-call-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-nodejs/README.md) | Node.js | Initiate an outbound phone call using the Telnyx Call Control API. Exposes an Express endpoint that dials a number and returns the call control ID. |
| [make-outbound-phone-call-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-php/README.md) | PHP | Place an outbound phone call with the Telnyx Call Control API using PHP. |
| [make-outbound-phone-call-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-python/README.md) | Python | Programmatically place an outbound phone call using Telnyx Call Control and handle the call lifecycle. |
| [make-outbound-phone-call-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/make-outbound-phone-call-ruby/README.md) | Ruby | Place an outbound phone call using the Telnyx Call Control API and the Telnyx Ruby SDK, exposed through a Sinatra endpoint. |
| [media-stream-voice-cloak-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/media-stream-voice-cloak-python/README.md) | Python | Media Stream Voice Cloak - real-time voice modification via media streaming API. Apply pitch shift, echo, or anonymization. |
| [merge-deal-desk-alerts-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-deal-desk-alerts-python/README.md) | Python | CRM webhook fires when a deal moves to negotiation, triggering Telnyx Voice and AI Inference alerts with Merge CRM. |
| [merge-employee-hotline-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-employee-hotline-python/README.md) | Python | Employees call and authenticate via caller ID using Telnyx Voice and AI Inference with Merge HRIS. |
| [merge-expense-by-phone-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-expense-by-phone-python/README.md) | Python | Salesperson calls and dictates an expense using Telnyx Voice and AI Inference with Merge Accounting. |
| [merge-interview-pipeline-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-interview-pipeline-python/README.md) | Python | ATS webhook fires when a new application arrives, triggering Telnyx Voice, AI Inference, and Messaging with Merge ATS. |
| [merge-invoice-collector-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-invoice-collector-python/README.md) | Python | Pulls overdue invoices from Merge Accounting and collects payments using Telnyx Voice, AI Inference, and Messaging. |
| [merge-pipeline-briefing-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-pipeline-briefing-python/README.md) | Python | Morning pipeline briefing delivered by Telnyx Voice and AI Inference with Merge CRM. |
| [merge-recruitment-hotline-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-recruitment-hotline-python/README.md) | Python | Job seekers call a recruitment hotline powered by Telnyx Voice, AI Inference, and Messaging with Merge ATS. |
| [merge-ticket-escalation-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-ticket-escalation-python/README.md) | Python | Critical ticket fires a webhook from Merge Ticketing, escalating via Telnyx Voice and AI Inference. |
| [multi-number-identity-router-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multi-number-identity-router-python/README.md) | Python | Multi-Number Identity Router - route calls based on which number was dialed. Each number maps to a different business identity, greeting, and routing destination. |
| [multilingual-voiceover-kit-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multilingual-voiceover-kit-python/README.md) | Python | Submit a script in one language, AI translates to multiple targets preserving tone and timing, TTS renders each language with native-sounding voices. Batch localization for 15 languages. |
| [number-lookup-fraud-screener-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/number-lookup-fraud-screener-python/README.md) | Python | Number Lookup Fraud Screener - screen inbound calls/messages for fraud indicators using number lookup before connecting. |
| [number-lookup-lead-enrichment-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/number-lookup-lead-enrichment-python/README.md) | Python | Number Lookup Lead Enrichment - CNAM and carrier lookup to qualify and enrich sales leads. |
| [number-porting-status-tracker-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/number-porting-status-tracker-python/README.md) | Python | Number Porting Status Tracker - track porting orders with status webhooks and SMS alerts. |
| [number-reputation-monitor-auto-rotate-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/number-reputation-monitor-auto-rotate-python/README.md) | Python | Number Reputation Monitor - track outbound number reputation, auto-rotate flagged numbers. |
| [number-search-and-purchase-api-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/number-search-and-purchase-api-python/README.md) | Python | Number Search and Purchase API - search, filter, and buy phone numbers programmatically. |
| [number-warmup-reputation-builder-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/number-warmup-reputation-builder-python/README.md) | Python | Number Warmup & Reputation Builder - gradually ramp SMS volume on new numbers to build carrier reputation and avoid spam flags. |
| [porting-loa-automation-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/porting-loa-automation-python/README.md) | Python | Porting LOA Automation - automate Letter of Authorization generation and porting order submission. |
| [porting-order-tracker-dashboard-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/porting-order-tracker-dashboard-python/README.md) | Python | Submit, track, and manage number porting orders with SLA monitoring, timeline visualization, and bulk operations. |
| [provisional-telnyx-voice-api-agents-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provisional-telnyx-voice-api-agents-nodejs/README.md) | Node.js | Start one reusable Telnyx AI Assistant on Telnyx Voice API calls with runtime business instructions selected by the called phone number. |
| [real-time-call-intelligence-dashboard-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/real-time-call-intelligence-dashboard-python/README.md) | Python | Real-Time Call Intelligence Dashboard - live transcription, sentiment analysis, and competitor detection. |
| [record-phone-calls-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-csharp/README.md) | C# | --- |
| [record-phone-calls-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-go/README.md) | Go | --- |
| [record-phone-calls-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-java/README.md) | Java | --- |
| [record-phone-calls-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-nodejs/README.md) | Node.js | Initiate outbound calls and control call recording using the Telnyx Voice API with Express. Handles call lifecycle webhooks and recording start/stop. |
| [record-phone-calls-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-php/README.md) | PHP | --- |
| [record-phone-calls-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-python/README.md) | Python | Record calls and receive recording webhooks. |
| [record-phone-calls-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-ruby/README.md) | Ruby | --- |
| [route-phone-calls-to-ai-agent-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-csharp/README.md) | C# | --- |
| [route-phone-calls-to-ai-agent-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-go/README.md) | Go | Receive inbound call webhooks from the Telnyx Voice API and answer calls programmatically with a Go + Gin server. |
| [route-phone-calls-to-ai-agent-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-java/README.md) | Java | --- |
| [route-phone-calls-to-ai-agent-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-nodejs/README.md) | Node.js | Receive inbound call webhooks from the Telnyx Voice API and answer calls programmatically with an Express server using Call Control. |
| [route-phone-calls-to-ai-agent-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-php/README.md) | PHP | --- |
| [route-phone-calls-to-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-python/README.md) | Python | Handle inbound calls with webhook-driven AI routing. |
| [route-phone-calls-to-ai-agent-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-ruby/README.md) | Ruby | Handle inbound calls with webhook-driven AI routing using Ruby and Sinatra. |
| [smart-number-geo-assignment-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/smart-number-geo-assignment-python/README.md) | Python | Smart Number Geo-Assignment - automatically purchase and assign local numbers based on caller geography to maximize answer rates. |
| [texml-dynamic-call-router-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/texml-dynamic-call-router-python/README.md) | Python | TeXML Dynamic Call Router - time-of-day and caller-based routing with TeXML responses. |
| [text-to-speech-phone-call-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/text-to-speech-phone-call-csharp/README.md) | C# | --- |
| [text-to-speech-phone-call-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/text-to-speech-phone-call-go/README.md) | Go | --- |
| [text-to-speech-phone-call-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/text-to-speech-phone-call-java/README.md) | Java | --- |
| [text-to-speech-phone-call-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/text-to-speech-phone-call-nodejs/README.md) | Node.js | Initiate an outbound voice call and play a text-to-speech message on answer using the Telnyx Call Control API. |
| [text-to-speech-phone-call-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/text-to-speech-phone-call-php/README.md) | PHP | --- |
| [text-to-speech-phone-call-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/text-to-speech-phone-call-python/README.md) | Python | Play text-to-speech audio during a phone call. |
| [text-to-speech-phone-call-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/text-to-speech-phone-call-ruby/README.md) | Ruby | --- |
| [transfer-live-phone-calls-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-csharp/README.md) | C# | --- |
| [transfer-live-phone-calls-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-go/README.md) | Go | --- |
| [transfer-live-phone-calls-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-java/README.md) | Java | --- |
| [transfer-live-phone-calls-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-nodejs/README.md) | Node.js | --- |
| [transfer-live-phone-calls-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-php/README.md) | PHP | --- |
| [transfer-live-phone-calls-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-python/README.md) | Python | Transfer active calls to another number or agent. |
| [transfer-live-phone-calls-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-ruby/README.md) | Ruby | --- |
| [video-voiceover-replacement-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/video-voiceover-replacement-python/README.md) | Python | Upload audio with existing voice-over. STT extracts the script, AI rewrites/improves it (5 modes: polish, professional, simplify, energize, shorten), TTS re-records with studio quality. |
| [video-webinar-recording-manager-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/video-webinar-recording-manager-python/README.md) | Python | Video Webinar Recording Manager - manage video room webinars with automatic recording, transcription, and clip extraction. |
| [voice-call-analytics-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voice-call-analytics-go/README.md) | Go | --- |
| [voice-call-analytics-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voice-call-analytics-nodejs/README.md) | Node.js | --- |
| [voice-call-analytics-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voice-call-analytics-php/README.md) | PHP | --- |
| [voice-call-analytics-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voice-call-analytics-python/README.md) | Python | --- |
| [voice-call-analytics-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voice-call-analytics-ruby/README.md) | Ruby | --- |
| [voice-to-slack-bridge-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voice-to-slack-bridge-python/README.md) | Python | Voice-to-Slack Bridge - call a phone number, speak a message, AI transcribes and posts to Slack with urgency tagging. |
| [voice-verified-identity-2fa-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voice-verified-identity-2fa-python/README.md) | Python | Voice-Verified Identity + 2FA - Number Lookup, SMS OTP, and AI-assisted secure transactions. |
| [voicemail-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voicemail-csharp/README.md) | C# | --- |
| [voicemail-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voicemail-go/README.md) | Go | --- |
| [voicemail-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voicemail-java/README.md) | Java | --- |
| [voicemail-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voicemail-nodejs/README.md) | Node.js | --- |
| [voicemail-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voicemail-php/README.md) | PHP | --- |
| [voicemail-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voicemail-python/README.md) | Python | --- |
| [voicemail-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voicemail-ruby/README.md) | Ruby | --- |
| [voiceover-audition-generator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voiceover-audition-generator-python/README.md) | Python | Submit a script, hear it read by every available TTS voice. AI scores and ranks best-fit voices based on content, tone, and audience. SMS delivers top picks to decision-makers. |
| [warm-transfer-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-csharp/README.md) | C# | --- |
| [warm-transfer-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-go/README.md) | Go | --- |
| [warm-transfer-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-java/README.md) | Java | --- |
| [warm-transfer-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-nodejs/README.md) | Node.js | --- |
| [warm-transfer-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-php/README.md) | PHP | --- |
| [warm-transfer-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-python/README.md) | Python | --- |
| [warm-transfer-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-ruby/README.md) | Ruby | --- |
| [webrtc-browser-calling-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/webrtc-browser-calling-python/README.md) | Python | Enable browser-based calling with WebRTC. |
| [wireguard-private-voice-network-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/wireguard-private-voice-network-python/README.md) | Python | WireGuard Private Voice Network - create WireGuard mesh network for private SIP trunking with encrypted voice traffic. |

</details>

<details open>
<summary><h2>SMS & MMS</h2> <em>(162 examples)</em></summary>

Send and receive text messages with the [Telnyx SMS API](https://telnyx.com/products/sms-api) - build autoresponders, implement 2FA, and manage bulk messaging campaigns.

| Example | Language | Description |
|---------|----------|-------------|
| [abandoned-cart-recovery-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/abandoned-cart-recovery-python/README.md) | Python | SMS 1h after abandon with incentive, AI voice call 24h later if no purchase. Integrates with Shopify webhooks and Stripe for discount codes. |
| [accounting-tax-season-line-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/accounting-tax-season-line-python/README.md) | Python | Handles scheduling, document checklist reminders, status updates. AI texts clients with missing doc reminders. CPA reviews readiness before appointments. |
| [after-hours-nurse-triage-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/after-hours-nurse-triage-python/README.md) | Python | AI screens symptoms using clinical decision tree, routes urgent to on-call nurse via PagerDuty, queues non-urgent for AM callback. Nurse reviews and overrides AI severity scores. |
| [ai-appointment-booking-sms-flow-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-appointment-booking-sms-flow-python/README.md) | Python | AI Appointment Booking SMS Flow - guided SMS booking with available slot selection. |
| [ai-appointment-reminder-sms-voice-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-appointment-reminder-sms-voice-python/README.md) | Python | AI Appointment Reminder - SMS first, voice call for non-responders, AI handles rescheduling. |
| [alphanumeric-sender-id-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/alphanumeric-sender-id-sms-python/README.md) | Python | Send SMS messages with a branded alphanumeric sender ID using the Telnyx Messaging API. Validates sender IDs and enforces regional restrictions. |
| [autonomous-outbound-sales-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/autonomous-outbound-sales-agent-python/README.md) | Python | Autonomous Outbound Sales Agent - AI-driven lead qualification, objection handling, and meeting booking. |
| [billing-anomaly-detector-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/billing-anomaly-detector-python/README.md) | Python | Billing Anomaly Detector - monitor usage and billing for anomalies, alert on cost spikes and unusual patterns. |
| [cdr-usage-analytics-dashboard-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/cdr-usage-analytics-dashboard-python/README.md) | Python | Pull Call Detail Records, build usage analytics with cost breakdowns, peak-hour analysis, and AI-powered insights. |
| [cloud-storage-media-cdn-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/cloud-storage-media-cdn-python/README.md) | Python | Cloud Storage Media CDN - use Telnyx Cloud Storage (S3-compatible) as a CDN for IVR prompts, hold music, and voice assets. |
| [e911-address-validator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/e911-address-validator-python/README.md) | Python | Validate and register emergency (E911) addresses for phone numbers via the Telnyx API. |
| [ecommerce-order-status-bot-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ecommerce-order-status-bot-python/README.md) | Python | Customers call or text order number, get real-time Shopify tracking. AI detects delivery exceptions and proactively texts customers before they call support. |
| [edge-compute-webhook-proxy-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-compute-webhook-proxy-python/README.md) | Python | Receive Telnyx voice and SMS webhooks at the edge with minimal latency. Validates, enriches with timestamps, HMAC-signs, and forwards to your backend. |
| [edge-mcp-server-deploy-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-mcp-server-deploy-python/README.md) | Python | Deploy an MCP server to Telnyx Edge Compute exposing Telnyx APIs as tools for AI agents. Send SMS, search numbers, run inference. |
| [elearning-course-narrator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/elearning-course-narrator-python/README.md) | Python | Upload course content, AI structures into audio modules with pacing cues and quiz prompts, TTS narrates each module, stores in Cloud Storage with a JSON manifest. |
| [emergency-mass-notification-system-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/emergency-mass-notification-system-python/README.md) | Python | Emergency Mass Notification System - SMS + voice calls with delivery tracking and escalation. |
| [fraud-alert-verification-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/fraud-alert-verification-python/README.md) | Python | Suspicious transaction triggers voice call to customer, verifies via DTMF, blocks or approves in real-time. Fraud team reviews edge cases via Slack. |
| [global-lead-response-engine-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/global-lead-response-engine-python/README.md) | Python | Global Lead Response Engine - multi-language AI qualification with live transfer and omnichannel follow-up. |
| [hosted-messaging-campaign-manager-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hosted-messaging-campaign-manager-python/README.md) | Python | Hosted Messaging Campaign Manager - manage hosted messaging campaigns with subscriber opt-in/out tracking and delivery analytics. |
| [interview-screen-scheduler-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/interview-screen-scheduler-python/README.md) | Python | Candidate applies, AI calls for 5-min phone screen, scores answers, books qualified candidates on hiring manager's calendar. Integrates with Greenhouse ATS and Google Calendar. |
| [isv-notification-engine-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/isv-notification-engine-python/README.md) | Python | SaaS platform sends alerts via SMS/voice/WhatsApp based on customer preference and urgency. Multi-channel with fallback cascade and delivery tracking. |
| [ivr-prompt-generator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ivr-prompt-generator-python/README.md) | Python | Generate professional IVR/phone system prompts. AI writes caller-friendly scripts from business descriptions, TTS renders in multiple voices, test via live Telnyx call playback. |
| [law-firm-client-intake-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/law-firm-client-intake-python/README.md) | Python | AI answers after-hours calls, screens case type, collects facts, runs conflict check, books consultation via Calendly, collects retainer deposit via Stripe. |
| [long-code-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/long-code-sms-python/README.md) | Python | Send A2P SMS over a long code with a rate-limited queue, delivery tracking, and signed inbound webhooks using the Telnyx Messaging API. |
| [marketplace-comms-bridge-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/marketplace-comms-bridge-python/README.md) | Python | Buyer texts about a listing, AI responds with details, facilitates anonymous buyer-seller connection via masked numbers, handles scheduling. Ops reviews flagged conversations. |
| [media-stream-custom-audio-mixer-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/media-stream-custom-audio-mixer-python/README.md) | Python | Media Stream Custom Audio Mixer - mix custom audio into live calls via WebSocket-based media streaming. |
| [media-stream-live-transcription-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/media-stream-live-transcription-python/README.md) | Python | Media Stream Live Transcription - fork call audio to WebSocket for real-time transcription display. |
| [merge-employee-onboarding-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/merge-employee-onboarding-python/README.md) | Python | New employee webhook from Merge HRIS triggers full provisioning: Telnyx phone number, AI voicemail greeting, welcome SMS with IT setup instructions, and IT ticket via Merge Ticketing. |
| [messaging-campaign-ab-test-optimizer-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/messaging-campaign-ab-test-optimizer-python/README.md) | Python | Messaging Campaign A/B Test Optimizer - test SMS copy variants, AI picks winners, auto-scales. |
| [migrate-from-elevenlabs-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/migrate-from-elevenlabs-python/README.md) | Python | Migrate from ElevenLabs - import ElevenLabs voice configurations to Telnyx TTS with voice mapping and cost comparison. |
| [migrate-from-twilio-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/migrate-from-twilio-python/README.md) | Python | Migrate from Twilio - complete Twilio-to-Telnyx migration tool: numbers, messaging profiles, voice apps, and webhook configs. |
| [migrate-from-vapi-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/migrate-from-vapi-python/README.md) | Python | Migrate from Vapi - import Vapi voice agents to Telnyx AI Assistants with voice, prompt, and tool configuration mapping. |
| [missions-workflow-orchestrator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/missions-workflow-orchestrator-python/README.md) | Python | Missions Workflow Orchestrator - create and manage multi-step mission workflows using the Telnyx Missions API. |
| [mms-photo-inventory-tracker-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/mms-photo-inventory-tracker-python/README.md) | Python | MMS Photo Inventory Tracker - text a photo of inventory items with MMS, AI identifies and catalogs them automatically. |
| [mms-receipt-scanner-expense-tracker-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/mms-receipt-scanner-expense-tracker-python/README.md) | Python | MMS Receipt Scanner & Expense Tracker - text a photo of a receipt, AI extracts data and tracks expenses. |
| [multi-channel-appointment-confirmation-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multi-channel-appointment-confirmation-python/README.md) | Python | Multi-Channel Appointment Confirmation - confirm appointments via SMS, voice call, and WhatsApp. Tries SMS first, escalates to voice if no response. |
| [multi-language-customer-survey-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multi-language-customer-survey-python/README.md) | Python | Multi-Language Customer Survey - outbound voice surveys in the caller's language with AI analysis. |
| [patient-appointment-engine-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/patient-appointment-engine-python/README.md) | Python | AI answers calls, checks availability, books appointments, collects copay via Stripe, sends SMS confirmation. Staff reviews next-day schedule. |
| [payment-reminder-escalation-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/payment-reminder-escalation-python/README.md) | Python | Invoice overdue: day 1 SMS, day 7 voice call with payment link, day 14 escalation to collections with full context. Integrates with Stripe/QuickBooks. |
| [phone-number-lookup-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-csharp/README.md) | C# | --- |
| [phone-number-lookup-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-go/README.md) | Go | --- |
| [phone-number-lookup-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-java/README.md) | Java | --- |
| [phone-number-lookup-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-nodejs/README.md) | Node.js | --- |
| [phone-number-lookup-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-php/README.md) | PHP | --- |
| [phone-number-lookup-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-python/README.md) | Python | Look up carrier, line type, and portability data for any phone number using the Telnyx Number Lookup API, with a 24-hour in-memory cache. |
| [phone-number-lookup-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-ruby/README.md) | Ruby | --- |
| [podcast-episode-repurposer-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/podcast-episode-repurposer-python/README.md) | Python | Upload a recorded episode, STT transcribes, AI Inference extracts key quotes and topics, TTS generates audiogram clips with different voices, SMS distributes clips to subscribers. |
| [podcast-highlight-clipper-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/podcast-highlight-clipper-python/README.md) | Python | Upload audio, STT + AI Inference identifies viral moments with virality scoring, TTS generates teaser intros for each clip, SMS distributes highlights to subscriber list. |
| [post-service-followup-engine-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/post-service-followup-engine-python/README.md) | Python | After appointment, SMS satisfaction survey. Negative responses trigger AI voice callback to understand the issue, then creates ticket in Jira and alerts manager via Slack. |
| [prescription-refill-line-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/prescription-refill-line-python/README.md) | Python | Patient calls, AI verifies identity (DOB + last 4 of phone), checks refill eligibility, sends approval to pharmacist via Slack. Pharmacist approves/denies, patient gets SMS. |
| [programmable-hold-experience-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/programmable-hold-experience-python/README.md) | Python | Programmable Hold Experience - custom hold experiences: tips, trivia, estimated wait time, callback offers. |
| [rcs-rich-card-product-catalog-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/rcs-rich-card-product-catalog-python/README.md) | Python | RCS Rich Card Product Catalog - AI-powered product recommendations with rich cards and carousels. |
| [receive-mms-webhook-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-mms-webhook-csharp/README.md) | C# | --- |
| [receive-mms-webhook-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-mms-webhook-go/README.md) | Go | --- |
| [receive-mms-webhook-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-mms-webhook-java/README.md) | Java | --- |
| [receive-mms-webhook-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-mms-webhook-nodejs/README.md) | Node.js | --- |
| [receive-mms-webhook-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-mms-webhook-php/README.md) | PHP | --- |
| [receive-mms-webhook-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-mms-webhook-python/README.md) | Python | Receive inbound MMS messages with a Telnyx webhook, verify the signature, and download media attachments. |
| [receive-mms-webhook-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-mms-webhook-ruby/README.md) | Ruby | --- |
| [receive-sms-webhook-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-csharp/README.md) | C# | Receive inbound SMS via webhook with Ed25519 signature verification using C# and ASP.NET. |
| [receive-sms-webhook-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-go/README.md) | Go | --- |
| [receive-sms-webhook-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-java/README.md) | Java | Receive inbound SMS via Telnyx webhooks with a JDK HttpServer, verifying the Ed25519 signature before reading data.payload. |
| [receive-sms-webhook-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-nodejs/README.md) | Node.js | Receive inbound SMS messages via Telnyx webhooks with an Express server. Validates payloads and acknowledges within 5 seconds. |
| [receive-sms-webhook-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-php/README.md) | PHP | Receive and Ed25519-verify inbound Telnyx SMS webhooks using the Telnyx PHP SDK over a vanilla PHP front controller. |
| [receive-sms-webhook-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-python/README.md) | Python | Receive inbound SMS via webhook. |
| [receive-sms-webhook-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-sms-webhook-ruby/README.md) | Ruby | Receive inbound SMS messages via Telnyx webhooks with a Sinatra server, verifying the Telnyx Ed25519 signature before trusting any payload. |
| [rent-collection-escalation-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/rent-collection-escalation-python/README.md) | Python | Automated multi-channel rent reminders. Day 1: SMS + Stripe payment link. Day 3: voice call. Day 7: late fee notice. Day 14: manager escalation. |
| [returns-processor-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/returns-processor-python/README.md) | Python | Customer texts photo of defective item via MMS, AI evaluates damage, auto-approves low-value refunds via Stripe, escalates high-value to team lead. |
| [schedule-sms-messages-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/schedule-sms-messages-csharp/README.md) | C# | --- |
| [schedule-sms-messages-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/schedule-sms-messages-go/README.md) | Go | --- |
| [schedule-sms-messages-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/schedule-sms-messages-java/README.md) | Java | --- |
| [schedule-sms-messages-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/schedule-sms-messages-nodejs/README.md) | Node.js | --- |
| [schedule-sms-messages-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/schedule-sms-messages-php/README.md) | PHP | --- |
| [schedule-sms-messages-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/schedule-sms-messages-python/README.md) | Python | Schedule SMS messages to be sent at a future time with the Telnyx Messaging API, backed by an APScheduler job store and a Flask job-management API. |
| [schedule-sms-messages-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/schedule-sms-messages-ruby/README.md) | Ruby | --- |
| [send-bulk-sms-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-csharp/README.md) | C# | --- |
| [send-bulk-sms-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-go/README.md) | Go | --- |
| [send-bulk-sms-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-java/README.md) | Java | --- |
| [send-bulk-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-nodejs/README.md) | Node.js | Send bulk SMS messages to many recipients with rate limiting and per-message error tracking using the Telnyx Messaging API and Express. |
| [send-bulk-sms-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-php/README.md) | PHP | --- |
| [send-bulk-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-python/README.md) | Python | Send SMS messages to multiple recipients. |
| [send-bulk-sms-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-ruby/README.md) | Ruby | --- |
| [send-mms-picture-message-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-mms-picture-message-csharp/README.md) | C# | --- |
| [send-mms-picture-message-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-mms-picture-message-go/README.md) | Go | --- |
| [send-mms-picture-message-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-mms-picture-message-java/README.md) | Java | --- |
| [send-mms-picture-message-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-mms-picture-message-nodejs/README.md) | Node.js | Send an MMS picture message with media attachments using the Telnyx Messaging API and a Node.js and Express endpoint. |
| [send-mms-picture-message-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-mms-picture-message-php/README.md) | PHP | --- |
| [send-mms-picture-message-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-mms-picture-message-python/README.md) | Python | Send an MMS message with image attachments using the Telnyx Messaging API. |
| [send-mms-picture-message-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-mms-picture-message-ruby/README.md) | Ruby | --- |
| [send-sms-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-csharp/README.md) | C# | Send an SMS message using the Telnyx Messaging API with a C# minimal ASP.NET endpoint. |
| [send-sms-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-go/README.md) | Go | Send an SMS message using the Telnyx Messaging API and Go SDK, exposed over a Gin HTTP endpoint. |
| [send-sms-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-java/README.md) | Java | Send an SMS message using the Telnyx Messaging API and Java SDK, exposed over a JDK HttpServer endpoint. |
| [send-sms-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-nodejs/README.md) | Node.js | Send an SMS message using the Telnyx Messaging API with a Node.js and Express endpoint. |
| [send-sms-notifications-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-notifications-csharp/README.md) | C# | --- |
| [send-sms-notifications-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-notifications-go/README.md) | Go | --- |
| [send-sms-notifications-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-notifications-java/README.md) | Java | --- |
| [send-sms-notifications-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-notifications-nodejs/README.md) | Node.js | --- |
| [send-sms-notifications-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-notifications-php/README.md) | PHP | --- |
| [send-sms-notifications-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-notifications-python/README.md) | Python | Production-ready Flask service that sends SMS notifications, tracks delivery status via webhooks, and exposes a small REST API. |
| [send-sms-notifications-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-notifications-ruby/README.md) | Ruby | --- |
| [send-sms-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-php/README.md) | PHP | Send an SMS message using the Telnyx Messaging API and the Telnyx PHP SDK, exposed through a vanilla PHP front controller. |
| [send-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-python/README.md) | Python | Send an SMS message using the Telnyx Messaging API. Supports delivery status webhooks. |
| [send-sms-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-ruby/README.md) | Ruby | Send an SMS message using the Telnyx Messaging API and the Telnyx Ruby SDK, exposed through a Rails controller endpoint. |
| [service-booking-dispatch-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/service-booking-dispatch-python/README.md) | Python | Customer calls HVAC/plumber/electrician, AI checks tech availability, books slot, collects deposit via Stripe, texts confirmation to customer and tech. |
| [shift-fill-engine-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/shift-fill-engine-python/README.md) | Python | Open shift triggers calls down the availability list. First to confirm gets it, rest are cancelled. Texts confirmation + notifies manager via Slack. |
| [shortcode-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/shortcode-sms-python/README.md) | Python | Send and receive two-way SMS over a Telnyx shortcode with Flask. Includes inbound webhook handling with signature verification. |
| [smart-ivr-ab-tester-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/smart-ivr-ab-tester-python/README.md) | Python | Smart IVR A/B Tester - run two IVR flows simultaneously and track which converts better. |
| [sms-appointment-no-show-predictor-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-appointment-no-show-predictor-python/README.md) | Python | SMS Appointment No-Show Predictor - AI predicts no-shows from SMS response patterns, triggers interventions. |
| [sms-auto-reply-bot-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-auto-reply-bot-csharp/README.md) | C# | --- |
| [sms-auto-reply-bot-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-auto-reply-bot-go/README.md) | Go | --- |
| [sms-auto-reply-bot-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-auto-reply-bot-java/README.md) | Java | --- |
| [sms-auto-reply-bot-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-auto-reply-bot-nodejs/README.md) | Node.js | Receive inbound SMS via signed Telnyx webhooks and send automatic replies using Node.js and Express. |
| [sms-auto-reply-bot-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-auto-reply-bot-php/README.md) | PHP | --- |
| [sms-auto-reply-bot-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-auto-reply-bot-python/README.md) | Python | Build an SMS autoresponder bot. |
| [sms-auto-reply-bot-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-auto-reply-bot-ruby/README.md) | Ruby | --- |
| [sms-chatbot-with-conversation-memory-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-chatbot-with-conversation-memory-python/README.md) | Python | SMS Chatbot with Conversation Memory - persistent AI conversations over text with context retention. |
| [sms-conversation-threading-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-conversation-threading-python/README.md) | Python | Group inbound and outbound SMS by contact into persistent conversation threads with the Telnyx Messaging API and a SQLAlchemy-backed store. |
| [sms-delivery-receipts-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-delivery-receipts-csharp/README.md) | C# | --- |
| [sms-delivery-receipts-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-delivery-receipts-go/README.md) | Go | --- |
| [sms-delivery-receipts-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-delivery-receipts-java/README.md) | Java | --- |
| [sms-delivery-receipts-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-delivery-receipts-nodejs/README.md) | Node.js | Track SMS delivery status with Telnyx webhooks. Send messages, receive finalized delivery receipts, and look up per-message status. |
| [sms-delivery-receipts-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-delivery-receipts-php/README.md) | PHP | --- |
| [sms-delivery-receipts-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-delivery-receipts-python/README.md) | Python | Track SMS delivery status with Telnyx message.finalized webhooks, store delivery receipts in SQLite, and query message status over HTTP. |
| [sms-delivery-receipts-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-delivery-receipts-ruby/README.md) | Ruby | --- |
| [sms-drip-campaign-engine-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-drip-campaign-engine-python/README.md) | Python | SMS Drip Campaign Engine - multi-step nurture sequences with branch logic and AI personalization. |
| [sms-emergency-check-in-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-emergency-check-in-python/README.md) | Python | SMS Emergency Check-In - periodic wellness checks via SMS with escalation to emergency contacts. |
| [sms-escape-room-game-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-escape-room-game-python/README.md) | Python | SMS Escape Room Game - text-based adventure game over SMS. Solve puzzles, find clues, escape before time runs out. |
| [sms-keyword-auto-responder-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-keyword-auto-responder-python/README.md) | Python | SMS Keyword Auto-Responder - keyword-triggered responses with match analytics. |
| [sms-marketing-campaign-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-marketing-campaign-python/README.md) | Python | Run bulk SMS marketing campaigns with Flask and the Telnyx Messaging API - create campaigns, send rate-limited batches, and track delivery via webhooks. |
| [sms-opt-out-management-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-opt-out-management-python/README.md) | Python | Manage SMS opt-out preferences with Telnyx. Auto-handles STOP/UNSUBSCRIBE replies via verified inbound webhooks, blocks messages to opted-out numbers, and keeps an auditable opt-out list in SQLite. |
| [sms-poll-voting-system-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-poll-voting-system-python/README.md) | Python | Text-to-vote polling with real-time results. |
| [sms-survey-bot-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-survey-bot-csharp/README.md) | C# | --- |
| [sms-survey-bot-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-survey-bot-go/README.md) | Go | --- |
| [sms-survey-bot-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-survey-bot-java/README.md) | Java | --- |
| [sms-survey-bot-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-survey-bot-nodejs/README.md) | Node.js | --- |
| [sms-survey-bot-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-survey-bot-php/README.md) | PHP | --- |
| [sms-survey-bot-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-survey-bot-python/README.md) | Python | Run multi-question SMS surveys over the Telnyx Messaging API. Sends questions, validates inbound replies via signed webhooks, tracks per-participant progress, and exposes results. |
| [sms-survey-bot-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-survey-bot-ruby/README.md) | Ruby | --- |
| [sms-trivia-game-tournament-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-trivia-game-tournament-python/README.md) | Python | SMS Trivia Game Tournament - multi-player trivia via SMS. Players join, answer timed questions, scores tracked on a live leaderboard. |
| [sms-two-factor-auth-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-two-factor-auth-csharp/README.md) | C# | --- |
| [sms-two-factor-auth-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-two-factor-auth-go/README.md) | Go | --- |
| [sms-two-factor-auth-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-two-factor-auth-java/README.md) | Java | --- |
| [sms-two-factor-auth-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-two-factor-auth-nodejs/README.md) | Node.js | Production-ready OTP 2FA system with Node.js and Express. Generates one-time passwords, delivers them over SMS via the Telnyx Messaging API, and verifies them with expiration, attempt limits, and rate limiting. |
| [sms-two-factor-auth-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-two-factor-auth-php/README.md) | PHP | --- |
| [sms-two-factor-auth-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-two-factor-auth-python/README.md) | Python | Implement SMS-based two-factor authentication. |
| [sms-two-factor-auth-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-two-factor-auth-ruby/README.md) | Ruby | --- |
| [toll-free-sms-campaign-manager-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/toll-free-sms-campaign-manager-python/README.md) | Python | Toll-Free SMS Campaign Manager - manage toll-free verification and send compliant campaigns. |
| [toll-free-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/toll-free-sms-python/README.md) | Python | Send SMS from a toll-free number with the Telnyx Messaging API and track delivery status via signed webhooks. |
| [two-way-sms-chat-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/two-way-sms-chat-csharp/README.md) | C# | --- |
| [two-way-sms-chat-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/two-way-sms-chat-go/README.md) | Go | --- |
| [two-way-sms-chat-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/two-way-sms-chat-java/README.md) | Java | --- |
| [two-way-sms-chat-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/two-way-sms-chat-nodejs/README.md) | Node.js | Send and receive SMS messages with Telnyx using Node.js and Express, with signature-verified inbound webhooks and automatic replies. |
| [two-way-sms-chat-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/two-way-sms-chat-php/README.md) | PHP | --- |
| [two-way-sms-chat-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/two-way-sms-chat-python/README.md) | Python | Send and receive SMS with Telnyx to run interactive, stateful text conversations over a Flask webhook. |
| [two-way-sms-chat-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/two-way-sms-chat-ruby/README.md) | Ruby | --- |
| [verify-multi-channel-auth-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/verify-multi-channel-auth-python/README.md) | Python | Verify Multi-Channel Auth - multi-channel verification: SMS first, fallback to voice call, then WhatsApp. Cascading 2FA. |
| [verify-phone-number-otp-flow-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/verify-phone-number-otp-flow-python/README.md) | Python | Verify Phone Number OTP Flow - Telnyx Verify API with SMS primary and voice call fallback. |
| [whatsapp-order-tracking-notifications-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/whatsapp-order-tracking-notifications-python/README.md) | Python | WhatsApp Order Tracking Notifications - proactive shipping updates and AI-powered order inquiries. |
| [whatsapp-sms-bridge-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/whatsapp-sms-bridge-python/README.md) | Python | WhatsApp-SMS Bridge - receive messages on WhatsApp and forward them via SMS, and vice versa. Bidirectional bridge between two messaging channels. |
| [whatsapp-verify-otp-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/whatsapp-verify-otp-python/README.md) | Python | Send and verify one-time passwords via WhatsApp using the Telnyx Verify API. |
| [white-label-appointment-platform-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/white-label-appointment-platform-python/README.md) | Python | Multi-tenant SaaS that gives any service business their own AI phone line with booking, reminders, and calendar sync. Each tenant has own number, greeting, and config. |
| [x402-usdc-account-funder-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/x402-usdc-account-funder-python/README.md) | Python | X402 USDC Account Funder - fund your Telnyx account with USDC cryptocurrency on the Base blockchain. |

</details>

<details open>
<summary><h2>AI Assistants</h2> <em>(114 examples)</em></summary>

Create, manage, and chat with [Telnyx AI Assistants](https://telnyx.com/ai-assistants) - LLM-powered agents for voice and messaging automation.

| Example | Language | Description |
|---------|----------|-------------|
| [ai-after-hours-emergency-triage-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-after-hours-emergency-triage-python/README.md) | Python | AI After-Hours Emergency Triage - after-hours calls screened by AI. True emergencies get forwarded to on-call; everything else gets a voicemail + next-day callback promise. |
| [ai-assistant-filler-messages-demo-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-filler-messages-demo-python/README.md) | Python | Webhook server with live split-screen dashboard for demoing AI Assistant filler messages during sync tool calls. |
| [ai-assistant-knowledge-base-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-knowledge-base-python/README.md) | Python | AI Assistant Knowledge Base - AI Assistant with document knowledge base for context-aware Q&A over uploaded documents. |
| [ai-assistant-multi-tool-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-multi-tool-python/README.md) | Python | AI Assistant Multi-Tool - AI Assistant with custom function-calling tools for CRM lookup, appointment booking, and order status. |
| [ai-assistant-phone-setup-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-phone-setup-python/README.md) | Python | AI Assistant Phone Setup - create and configure a managed Telnyx AI Assistant and wire it to a phone number. |
| [ai-audiobook-narrator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-audiobook-narrator-python/README.md) | Python | Submit text, AI Inference chunks into chapters with pacing/emotion markup, TTS narrates each chapter with consistent voice, stores final audio in Telnyx Cloud Storage. |
| [ai-billing-dispute-resolution-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-billing-dispute-resolution-agent-python/README.md) | Python | AI Billing Dispute Resolution Agent - handles billing questions with account lookup. |
| [ai-call-center-quality-scorer-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-call-center-quality-scorer-python/README.md) | Python | AI Call Center Quality Scorer - automatically score agent performance from call recordings on compliance, empathy, resolution, and talk-to-listen ratio. |
| [ai-cold-caller-objection-trainer-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-cold-caller-objection-trainer-python/README.md) | Python | AI Cold Caller Objection Trainer - practice handling sales objections with AI-generated scenarios. |
| [ai-competitive-win-loss-call-analyzer-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-competitive-win-loss-call-analyzer-python/README.md) | Python | AI Competitive Win/Loss Call Analyzer - analyze recorded sales calls for competitive intelligence. |
| [ai-compliance-quiz-phone-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-compliance-quiz-phone-python/README.md) | Python | AI Compliance Quiz Phone - employees call and take a compliance quiz. AI asks questions, evaluates answers, scores pass/fail, records completion. |
| [ai-conference-moderator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-conference-moderator-python/README.md) | Python | AI moderator for multi-party calls. Manages agenda, enforces time limits, tracks speakers, produces structured summary with action items. |
| [ai-conference-note-taker-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-conference-note-taker-python/README.md) | Python | AI Conference Note-Taker - joins calls, transcribes, extracts action items, sends SMS summaries. |
| [ai-content-translator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-content-translator-python/README.md) | Python | Upload any audio (podcast, meeting, lecture), STT transcribes in source language, AI Inference translates, TTS generates audio in target language. Returns translated transcript and a downloadable dubbed audio file. |
| [ai-customer-churn-predictor-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-customer-churn-predictor-python/README.md) | Python | AI Customer Churn Predictor - analyze call/message patterns via Telnyx APIs, AI predicts churn risk and suggests interventions. |
| [ai-customer-winback-caller-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-customer-winback-caller-python/README.md) | Python | AI Customer Winback Caller - AI calls churned customers with personalized re-engagement offers. |
| [ai-debt-collection-compliance-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-debt-collection-compliance-agent-python/README.md) | Python | AI Debt Collection Compliance Agent - FDCPA-compliant outbound collection with real-time guardrails. |
| [ai-deposition-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-deposition-assistant-python/README.md) | Python | AI joins legal deposition calls, produces real-time transcript, flags objectionable questions, tracks exhibits, generates structured deposition summary. |
| [ai-event-rsvp-phone-line-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-event-rsvp-phone-line-python/README.md) | Python | AI Event RSVP Phone Line - call to RSVP for an event. AI collects guest info, dietary restrictions, plus-ones, and confirms the reservation. |
| [ai-hiring-phone-screen-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-hiring-phone-screen-python/README.md) | Python | AI Hiring Phone Screen - automated first-round phone screening for job applicants. |
| [ai-insurance-claims-intake-voice-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-insurance-claims-intake-voice-python/README.md) | Python | AI Insurance Claims Intake - voice agent collects claim details, classifies, routes to adjuster. |
| [ai-language-learning-phone-tutor-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-language-learning-phone-tutor-python/README.md) | Python | AI Language Learning Phone Tutor - call a number, practice a foreign language with AI. |
| [ai-live-call-participant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-live-call-participant-python/README.md) | Python | AI joins a live multi-human conference call as an active participant. Listens via media streaming, contributes via TTS, takes notes, responds when addressed by name. |
| [ai-medical-appointment-prep-caller-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-medical-appointment-prep-caller-python/README.md) | Python | AI Medical Appointment Prep Caller - calls patients before appointments to collect intake info. |
| [ai-meeting-action-tracker-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-meeting-action-tracker-python/README.md) | Python | Joins multi-party calls, identifies speakers, extracts action items with owners and deadlines, posts structured notes to Slack. |
| [ai-negotiation-practice-phone-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-negotiation-practice-phone-python/README.md) | Python | AI Negotiation Practice Phone - practice salary negotiations, sales deals, or vendor contracts with an AI that plays the opposing side and scores your technique. |
| [ai-phone-story-hotline-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-phone-story-hotline-python/README.md) | Python | AI Phone Story Hotline - call a number, choose a genre, and listen to an AI-generated interactive story where your choices shape the narrative. |
| [ai-phone-tree-builder-from-description-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-phone-tree-builder-from-description-python/README.md) | Python | AI Phone Tree Builder - describe your business in English, AI creates a working phone system. |
| [ai-podcast-call-in-show-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-podcast-call-in-show-python/README.md) | Python | AI Podcast Call-In Show - callers dial in, AI screens and queues them, host manages live. |
| [ai-podcast-post-producer-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-podcast-post-producer-python/README.md) | Python | AI Podcast Post-Producer - record a podcast over a conference call, then AI generates show notes, timestamps, highlights, and social media clips. |
| [ai-podcast-producer-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-podcast-producer-python/README.md) | Python | Record a multi-host podcast via conference call, transcribe each speaker with STT, generate show notes + chapters + social clips via AI Inference, and produce TTS intro/outro bumpers. |
| [ai-powered-ivr-replacement-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-powered-ivr-replacement-python/README.md) | Python | AI-Powered IVR Replacement - natural language routing with A/B testing and structured insights. |
| [ai-price-quote-phone-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-price-quote-phone-agent-python/README.md) | Python | AI Price Quote Phone Agent - caller describes what they need, AI generates a customized price quote in real time with line items. |
| [ai-property-management-maintenance-line-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-property-management-maintenance-line-python/README.md) | Python | AI Property Management Maintenance Line - tenants call, AI triages maintenance requests. |
| [ai-real-estate-showing-scheduler-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-real-estate-showing-scheduler-python/README.md) | Python | AI Real Estate Showing Scheduler - buyers call or text, AI checks availability and books showings. |
| [ai-real-time-translation-bridge-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-real-time-translation-bridge-python/README.md) | Python | Connect two callers who speak different languages with real-time AI translation on a live phone call. Built with Telnyx Voice Call Control and AI Inference. |
| [ai-receptionist-with-booking-tools-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-receptionist-with-booking-tools-python/README.md) | Python | AI Receptionist with Booking Tools - AI Assistant with tool_use for real calendar booking actions. |
| [ai-restaurant-reservation-voice-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-restaurant-reservation-voice-agent-python/README.md) | Python | AI Restaurant Reservation Voice Agent - handles calls, checks availability, books tables, sends SMS confirmation. |
| [ai-sales-call-with-live-crm-updates-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-sales-call-with-live-crm-updates-python/README.md) | Python | AI Sales Call with Live CRM Updates - multi-participant call with real-time deal intelligence. |
| [ai-sales-coach-whisper-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-sales-coach-whisper-python/README.md) | Python | AI coach listens to a live sales call and whispers real-time suggestions to the rep only. Customer never hears the AI. Generates post-call scorecard. |
| [ai-sales-demo-booking-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-sales-demo-booking-agent-python/README.md) | Python | AI Sales Demo Booking Agent - inbound calls, AI qualifies the lead, books a demo on the calendar. |
| [ai-standup-facilitator-phone-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-standup-facilitator-phone-python/README.md) | Python | AI Standup Facilitator Phone - team members call in their daily standup update. AI collects what they did, what they're doing, and blockers, then summarizes for the team. |
| [ai-subscription-cancel-save-retention-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-subscription-cancel-save-retention-agent-python/README.md) | Python | Inbound voice agent that handles subscription cancellation requests, classifies the reason with AI, offers one eligible save option, and records saved, cancelled, paused, transferred, or follow-up outcomes. |
| [ai-tech-support-voice-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-tech-support-voice-agent-python/README.md) | Python | IT helpdesk voice agent that answers calls, troubleshoots issues using a knowledge base, and escalates to human support via Telnyx Voice AI and Inference. |
| [ai-video-dubbing-pipeline-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-video-dubbing-pipeline-python/README.md) | Python | Upload audio, STT transcribes with speaker diarization, AI Inference translates to target language, TTS generates dubbed audio with speaker-matched voices. Full STT-to-TTS pipeline. |
| [ai-voice-agent-with-function-calling-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-voice-agent-with-function-calling-python/README.md) | Python | AI Voice Agent with Function Calling - voice agent that calls external APIs mid-conversation. |
| [ai-voice-memo-to-email-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-voice-memo-to-email-python/README.md) | Python | AI Voice Memo to Email - call a number, dictate a memo, AI cleans it up and sends it as a formatted email via Telnyx. |
| [ai-voice-survey-sentiment-tracker-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-voice-survey-sentiment-tracker-python/README.md) | Python | AI Voice Survey Sentiment Tracker - real-time CSAT scoring from voice tone and word choice. |
| [ai-voicemail-transcription-forwarding-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-voicemail-transcription-forwarding-python/README.md) | Python | AI Voicemail Transcription & Forwarding - voicemail to AI-summarized SMS/email with priority classification. |
| [ai-voiceover-studio-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-voiceover-studio-python/README.md) | Python | Upload a script, select voice/style/pacing, AI adds professional direction cues (pauses, emphasis, pacing), TTS renders the voice-over, stores output in Cloud Storage. Supports multiple takes and retakes. |
| [build-rag-with-telnyx-inference-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-rag-with-telnyx-inference-python/README.md) | Python | Build a retrieval-augmented generation API with Telnyx embeddings and chat completions. |
| [build-voice-ai-agent-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-voice-ai-agent-nodejs/README.md) | Node.js | Build a complete voice AI agent with Telnyx - answer inbound calls, transcribe speech, generate replies with Telnyx Inference, and speak them back via Call Control. |
| [build-voice-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-voice-ai-agent-python/README.md) | Python | Build a complete voice AI agent with Telnyx - inbound call handling, AI conversation, and call control. |
| [call-recording-ai-summarizer-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-recording-ai-summarizer-python/README.md) | Python | Call Recording AI Summarizer - record calls, then summarize and extract action items with AI. |
| [changelog-generator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/changelog-generator-python/README.md) | Python | AI Changelog Generator — turn git commits and diffs into a clean, human-readable changelog via Telnyx AI Inference. |
| [chat-with-ai-assistant-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-csharp/README.md) | C# | --- |
| [chat-with-ai-assistant-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-go/README.md) | Go | Send messages to a Telnyx AI assistant and maintain multi-turn context with a conversation id, using a Go + Gin server. |
| [chat-with-ai-assistant-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-java/README.md) | Java | Chat with a Telnyx AI Assistant and thread a multi-turn conversation using the Telnyx Java SDK over a JDK HttpServer endpoint. |
| [chat-with-ai-assistant-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-nodejs/README.md) | Node.js | Send a message to a Telnyx AI Assistant and return its response over a production-ready Express endpoint. |
| [chat-with-ai-assistant-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-php/README.md) | PHP | Send a message to a Telnyx AI Assistant from a vanilla PHP front controller and return its reply, keeping conversation context across turns. |
| [chat-with-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-python/README.md) | Python | Send messages to a Telnyx AI Assistant and receive responses. Supports conversation history and streaming. |
| [chat-with-ai-assistant-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/chat-with-ai-assistant-ruby/README.md) | Ruby | Chat with a Telnyx AI Assistant and maintain conversation context over a production-ready Sinatra endpoint using the Telnyx Ruby SDK. |
| [click-to-call-webrtc-with-ai-assist-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/click-to-call-webrtc-with-ai-assist-python/README.md) | Python | Click-to-Call WebRTC with AI Assist - browser-based calling with real-time AI coaching sidebar. |
| [clone-ai-assistant-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/clone-ai-assistant-csharp/README.md) | C# | --- |
| [clone-ai-assistant-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/clone-ai-assistant-go/README.md) | Go | --- |
| [clone-ai-assistant-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/clone-ai-assistant-java/README.md) | Java | --- |
| [clone-ai-assistant-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/clone-ai-assistant-nodejs/README.md) | Node.js | --- |
| [clone-ai-assistant-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/clone-ai-assistant-php/README.md) | PHP | --- |
| [clone-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/clone-ai-assistant-python/README.md) | Python | Clone an existing AI assistant configuration. |
| [clone-ai-assistant-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/clone-ai-assistant-ruby/README.md) | Ruby | --- |
| [compliance-call-recorder-ai-auditor-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/compliance-call-recorder-ai-auditor-python/README.md) | Python | Compliance Call Recorder + AI Auditor - auto-record, batch-process with AI, flag violations, create tickets. |
| [conference-call-with-ai-summary-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/conference-call-with-ai-summary-python/README.md) | Python | Conference Call with AI Summary - multi-party conference with transcription and AI post-call summary. |
| [create-ai-assistant-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-csharp/README.md) | C# | --- |
| [create-ai-assistant-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-go/README.md) | Go | --- |
| [create-ai-assistant-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-java/README.md) | Java | --- |
| [create-ai-assistant-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-nodejs/README.md) | Node.js | Create a Telnyx AI Assistant over an HTTP endpoint using the Telnyx Node.js SDK and Express. |
| [create-ai-assistant-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-php/README.md) | PHP | --- |
| [create-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-python/README.md) | Python | Create a new Telnyx AI Assistant with a system prompt, model selection, and tool configuration. |
| [create-ai-assistant-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-ruby/README.md) | Ruby | --- |
| [error-explainer-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/error-explainer-python/README.md) | Python | AI Error Explainer — paste a stack trace, get a root-cause hypothesis, confidence, severity, and a suggested fix via Telnyx AI Inference. |
| [extract-structured-json-with-ai-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/extract-structured-json-with-ai-python/README.md) | Python | Extract structured JSON from support tickets, emails, leads, or incident reports with Telnyx AI Inference. |
| [fax-to-ai-document-processor-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/fax-to-ai-document-processor-python/README.md) | Python | Fax to AI Document Processor - receive fax, AI extracts data, forwards structured summary. |
| [full-stack-ai-contact-center-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/full-stack-ai-contact-center-python/README.md) | Python | Full-Stack AI Contact Center - complete contact center: IVR + queue + AI agent assist + recording + live analytics. |
| [get-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/get-ai-assistant-python/README.md) | Python | --- |
| [global-ip-failover-monitor-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/global-ip-failover-monitor-python/README.md) | Python | Global IP Failover Monitor - monitor Global IP endpoints across regions, auto-failover between healthy endpoints. |
| [insurance-claims-intake-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/insurance-claims-intake-python/README.md) | Python | Policyholder calls, AI collects incident details, accepts photos via MMS, creates claim, assigns adjuster, texts status updates. Adjuster reviews AI-prepared claim. |
| [list-ai-assistants-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/list-ai-assistants-csharp/README.md) | C# | --- |
| [list-ai-assistants-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/list-ai-assistants-go/README.md) | Go | --- |
| [list-ai-assistants-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/list-ai-assistants-java/README.md) | Java | --- |
| [list-ai-assistants-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/list-ai-assistants-nodejs/README.md) | Node.js | List all AI assistants in your Telnyx account using the Telnyx Node.js SDK and an Express endpoint. |
| [list-ai-assistants-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/list-ai-assistants-php/README.md) | PHP | --- |
| [list-ai-assistants-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/list-ai-assistants-python/README.md) | Python | List all Telnyx AI Assistants in your account with filtering and pagination. |
| [list-ai-assistants-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/list-ai-assistants-ruby/README.md) | Ruby | --- |
| [maintenance-request-dispatch-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/maintenance-request-dispatch-python/README.md) | Python | Tenant texts issue, AI categorizes and estimates cost, auto-dispatches vendor for routine work, manager approves orders over $500 via SMS reply. |
| [missions-ai-task-runner-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/missions-ai-task-runner-python/README.md) | Python | Missions AI Task Runner - AI-driven task execution within the Telnyx Missions framework. AI decides next steps based on task results. |
| [multi-channel-ai-helpdesk-with-ticketing-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multi-channel-ai-helpdesk-with-ticketing-python/README.md) | Python | Multi-Channel AI Helpdesk with Ticketing - voice + SMS + WhatsApp support with auto-ticket creation. |
| [multi-party-ai-training-call-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/multi-party-ai-training-call-python/README.md) | Python | AI plays customer roles for sales/support practice. Multiple trainees join, AI rotates scenarios and scores each trainee. |
| [omnichannel-ai-receptionist-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/omnichannel-ai-receptionist-python/README.md) | Python | One AI brain that handles inbound calls, SMS, and WhatsApp with unified conversation context and intelligent routing via Telnyx AI Inference. |
| [outbound-hold-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/outbound-hold-agent-python/README.md) | Python | Call a business, navigate IVRs with a Telnyx AI Assistant, pause the assistant during hold, monitor with transcription, and resume with context when a representative answers. |
| [policy-renewal-campaign-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/policy-renewal-campaign-python/README.md) | Python | Automated multi-channel renewal reminders. 60 days: SMS. 30 days: AI voice call reviewing coverage changes. 7 days: urgent SMS. Agent reviews lapsed policies for win-back. |
| [restaurant-reservation-waitlist-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/restaurant-reservation-waitlist-python/README.md) | Python | AI answers calls, checks table availability, books or adds to waitlist, texts when table is ready. Host reviews large party requests. |
| [run-llm-inference-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/run-llm-inference-nodejs/README.md) | Node.js | Run large language model inference through the Telnyx Inference API using an OpenAI-compatible chat completions interface from Node.js. Works as both an HTTP server and a CLI tool. |
| [run-llm-inference-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/run-llm-inference-python/README.md) | Python | Send chat completion requests to the Telnyx Inference API using an OpenAI-compatible interface from Python. |
| [sql-natural-language-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sql-natural-language-python/README.md) | Python | AI SQL Natural Language — turn plain-English questions into validated SQL with schema context via Telnyx AI Inference. Includes a sample dataset for live execution. |
| [storage-voicemail-archive-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/storage-voicemail-archive-python/README.md) | Python | Storage Voicemail Archive - record voicemails to Telnyx Cloud Storage with search. |
| [texml-voicemail-drop-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/texml-voicemail-drop-python/README.md) | Python | Leave pre-recorded voicemails at scale via TeXML. |
| [three-way-ai-interpreter-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/three-way-ai-interpreter-python/README.md) | Python | Two humans speak different languages on the same call. AI translates in real-time and speaks the translation to each party. |
| [update-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/update-ai-assistant-python/README.md) | Python | Update an existing Telnyx AI Assistant's configuration, model, system prompt, and tools via the API. |
| [video-room-ai-meeting-moderator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/video-room-ai-meeting-moderator-python/README.md) | Python | Video Room AI Meeting Moderator - create video rooms with AI-powered agenda tracking and time management. |
| [video-room-ai-moderator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/video-room-ai-moderator-python/README.md) | Python | Video Room AI Moderator - create video rooms with AI-powered content moderation on chat and participant management. |
| [voice-journal-daily-log-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voice-journal-daily-log-python/README.md) | Python | Voice Journal Daily Log - call a number, speak your daily journal entry, AI transcribes and organizes it with mood, topics, and gratitude extraction. |
| [warm-transfer-ai-briefing-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-ai-briefing-python/README.md) | Python | When an agent transfers a call, AI summarizes the conversation and briefs the next agent before connecting. No cold handoffs. |
| [webhook-debugger-ai-assistant-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/webhook-debugger-ai-assistant-python/README.md) | Python | Webhook Debugger AI Assistant - catch, inspect, and debug Telnyx webhooks with AI explanations. |
| [webrtc-ai-interpreter-live-calls-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/webrtc-ai-interpreter-live-calls-python/README.md) | Python | WebRTC AI Interpreter for Live Calls - real-time translation between two callers speaking different languages. |

</details>

<details open>
<summary><h2>SIP Trunking</h2> <em>(35 examples)</em></summary>

Connect your PBX or SBC to [Telnyx SIP Trunking](https://telnyx.com/products/sip-trunks) - trunk setup, inbound routing, failover, and codec configuration.

| Example | Language | Description |
|---------|----------|-------------|
| [configure-sip-codecs-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/configure-sip-codecs-python/README.md) | Python | Configure audio codecs for SIP trunks. |
| [inbound-sip-routing-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-csharp/README.md) | C# | --- |
| [inbound-sip-routing-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-go/README.md) | Go | --- |
| [inbound-sip-routing-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-java/README.md) | Java | --- |
| [inbound-sip-routing-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-nodejs/README.md) | Node.js | Create and manage Telnyx SIP connections for inbound call routing, and receive inbound call webhooks, using Node.js and Express. |
| [inbound-sip-routing-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-php/README.md) | PHP | --- |
| [inbound-sip-routing-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-python/README.md) | Python | Route inbound SIP calls to your endpoints. |
| [inbound-sip-routing-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-ruby/README.md) | Ruby | --- |
| [setup-sip-trunk-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-csharp/README.md) | C# | Create, list, and retrieve credential-authenticated SIP connections using the Telnyx.net SDK and minimal ASP.NET. |
| [setup-sip-trunk-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-go/README.md) | Go | Create, list, and retrieve Telnyx SIP trunk connections via a Go and Gin REST API. |
| [setup-sip-trunk-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-java/README.md) | Java | Create, list, and retrieve credential-authenticated Telnyx SIP connections with the Telnyx Java SDK and the JDK's built-in HTTP server. |
| [setup-sip-trunk-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-nodejs/README.md) | Node.js | Create, retrieve, and list credential-authenticated SIP connections using the Telnyx SIP Trunking API. |
| [setup-sip-trunk-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-php/README.md) | PHP | Create, list, and retrieve a Telnyx credential (SIP) connection using the Telnyx PHP SDK over a vanilla PHP front controller. |
| [setup-sip-trunk-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-python/README.md) | Python | Provision and configure a SIP trunk connection on Telnyx with codec preferences, authentication, and failover. |
| [setup-sip-trunk-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-ruby/README.md) | Ruby | Create, list, and retrieve credential-authenticated SIP connections using the Telnyx SIP Trunking API with Ruby and Sinatra. |
| [sip-cnam-lookup-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-cnam-lookup-csharp/README.md) | C# | --- |
| [sip-cnam-lookup-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-cnam-lookup-go/README.md) | Go | --- |
| [sip-cnam-lookup-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-cnam-lookup-java/README.md) | Java | --- |
| [sip-cnam-lookup-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-cnam-lookup-nodejs/README.md) | Node.js | --- |
| [sip-cnam-lookup-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-cnam-lookup-php/README.md) | PHP | --- |
| [sip-cnam-lookup-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-cnam-lookup-python/README.md) | Python | --- |
| [sip-cnam-lookup-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-cnam-lookup-ruby/README.md) | Ruby | --- |
| [sip-failover-routing-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-go/README.md) | Go | --- |
| [sip-failover-routing-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-nodejs/README.md) | Node.js | --- |
| [sip-failover-routing-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-python/README.md) | Python | Configure failover routing for SIP connections. |
| [sip-failover-routing-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-ruby/README.md) | Ruby | --- |
| [sip-load-balancer-health-check-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-load-balancer-health-check-python/README.md) | Python | SIP Load Balancer Health Check - monitor SIP trunk health across multiple endpoints, auto-failover to healthy trunks, track uptime metrics. |
| [sip-registration-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-csharp/README.md) | C# | --- |
| [sip-registration-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-go/README.md) | Go | --- |
| [sip-registration-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-java/README.md) | Java | --- |
| [sip-registration-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-nodejs/README.md) | Node.js | --- |
| [sip-registration-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-php/README.md) | PHP | --- |
| [sip-registration-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-python/README.md) | Python | --- |
| [sip-registration-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-ruby/README.md) | Ruby | --- |
| [sip-trunking-failover-monitor-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-trunking-failover-monitor-python/README.md) | Python | SIP Trunking Failover Monitor - health-check SIP connections, auto-failover, SMS alerts. |

</details>

<details open>
<summary><h2>IoT & SIM Management</h2> <em>(34 examples)</em></summary>

Activate SIM cards, monitor data usage, provision eSIMs, and track device locations with the [Telnyx IoT platform](https://telnyx.com/products/iot-sim-card).

| Example | Language | Description |
|---------|----------|-------------|
| [activate-sim-card-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-csharp/README.md) | C# | Enable (activate) a SIM card on the Telnyx network using C# and ASP.NET. |
| [activate-sim-card-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-go/README.md) | Go | Activate a Telnyx IoT SIM card over HTTP using the Telnyx Go SDK and Gin. |
| [activate-sim-card-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-java/README.md) | Java | Activate a Telnyx IoT SIM card over HTTP using the Telnyx Java SDK and the JDK HttpServer. |
| [activate-sim-card-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-nodejs/README.md) | Node.js | Retrieve and activate a Telnyx IoT SIM card by ID using the Telnyx Node.js SDK over an Express API. |
| [activate-sim-card-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-php/README.md) | PHP | Enable (activate) a Telnyx IoT SIM card by ID using the Telnyx PHP SDK over a vanilla PHP front controller. |
| [activate-sim-card-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-python/README.md) | Python | Activate a SIM card on the Telnyx network. |
| [activate-sim-card-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/activate-sim-card-ruby/README.md) | Ruby | Activate a Telnyx IoT SIM card using Ruby and Sinatra. |
| [iot-fleet-alert-escalation-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/iot-fleet-alert-escalation-python/README.md) | Python | IoT Fleet Alert Escalation - severity-based routing from IoT sensors to SMS, calls, and multi-party conferences. |
| [iot-mqtt-messaging-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/iot-mqtt-messaging-python/README.md) | Python | --- |
| [iot-panic-button-voice-alert-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/iot-panic-button-voice-alert-python/README.md) | Python | IoT Panic Button Voice Alert - IoT device triggers SIM-based alert, system calls emergency contacts with location and status. |
| [iot-smart-building-voice-control-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/iot-smart-building-voice-control-python/README.md) | Python | IoT Smart Building Voice Control - call a number to control building systems via AI + IoT SIMs. |
| [monitor-iot-data-usage-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-csharp/README.md) | C# | --- |
| [monitor-iot-data-usage-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-go/README.md) | Go | --- |
| [monitor-iot-data-usage-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-java/README.md) | Java | --- |
| [monitor-iot-data-usage-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-nodejs/README.md) | Node.js | Monitor Telnyx IoT SIM card data usage with an Express server that polls usage on an interval and exposes REST endpoints for per-SIM consumption and threshold alerts. |
| [monitor-iot-data-usage-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-php/README.md) | PHP | --- |
| [monitor-iot-data-usage-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-python/README.md) | Python | Production-ready Flask application for monitoring SIM card data usage via Telnyx IoT API. |
| [monitor-iot-data-usage-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-ruby/README.md) | Ruby | --- |
| [provision-esim-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-go/README.md) | Go | --- |
| [provision-esim-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-java/README.md) | Java | --- |
| [provision-esim-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-nodejs/README.md) | Node.js | --- |
| [provision-esim-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-php/README.md) | PHP | --- |
| [provision-esim-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-python/README.md) | Python | Provision eSIM profiles over the air. |
| [provision-esim-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-ruby/README.md) | Ruby | --- |
| [sim-fleet-data-usage-anomaly-detector-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sim-fleet-data-usage-anomaly-detector-python/README.md) | Python | SIM Fleet Data Usage Anomaly Detector - monitor IoT SIM usage, AI detects anomalies, SMS alerts. |
| [track-iot-device-location-csharp](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/track-iot-device-location-csharp/README.md) | C# | --- |
| [track-iot-device-location-go](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/track-iot-device-location-go/README.md) | Go | --- |
| [track-iot-device-location-java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/track-iot-device-location-java/README.md) | Java | --- |
| [track-iot-device-location-nodejs](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/track-iot-device-location-nodejs/README.md) | Node.js | --- |
| [track-iot-device-location-php](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/track-iot-device-location-php/README.md) | PHP | --- |
| [track-iot-device-location-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/track-iot-device-location-python/README.md) | Python | Production-ready Flask application for device location tracking via Telnyx IoT API. |
| [track-iot-device-location-ruby](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/track-iot-device-location-ruby/README.md) | Ruby | --- |
| [voice-activated-iot-command-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voice-activated-iot-command-python/README.md) | Python | Voice-Activated IoT Command - call a number, speak commands to control IoT devices. AI interprets natural language into device actions dispatched via SIM API. |
| [wireless-fleet-activation-portal-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/wireless-fleet-activation-portal-python/README.md) | Python | Bulk activate SIMs with status tracking. |

</details>

---

## What Is Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that provides a single, integrated API for:

- **[Voice AI](https://telnyx.com/products/voice-ai-agents)** - Programmable voice with Call Control, IVR, recording, conferencing, and WebRTC.
- **[SMS & MMS](https://telnyx.com/products/sms-api)** - Send and receive messages globally with delivery receipts and webhook events.
- **[SIP Trunking](https://telnyx.com/products/sip-trunks)** - Connect your existing PBX with elastic SIP trunks, failover routing, and codec control.
- **[AI Assistants](https://telnyx.com/ai-assistants)** - Deploy LLM-powered voice and messaging agents with built-in telephony.
- **[IoT & SIM](https://telnyx.com/products/iot-sim-card)** - Global IoT connectivity with SIM management, eSIM provisioning, and data monitoring.

Unlike stitching together multiple vendors into a Frankenstack, Telnyx gives you one platform, one API key, and one bill. Calls and messages traverse the Telnyx-owned private IP network for lower latency and higher reliability.

## How to Get a Telnyx API Key

1. Sign up at [portal.telnyx.com](https://portal.telnyx.com).
2. Navigate to **API Keys** in the left sidebar.
3. Click **Create API Key** and copy the key.
4. Add it to your `.env` file as `TELNYX_API_KEY=your_key_here`.

Telnyx offers free trial credit for testing.

## FAQ

**Q: What programming languages are supported?**

These examples cover Python, Node.js, Go, and Ruby. Telnyx also provides official SDKs for Java, PHP, and C#.

**Q: Are these examples production-ready?**

Yes. Every example includes error handling, environment-based configuration, and Telnyx webhook signature verification. Review security and scaling considerations before deploying to production.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network. It offers integrated voice, messaging, AI, SIP, and IoT under one API - no need to stitch together multiple vendors. Telnyx also offers significantly lower pricing with no per-seat fees or contracts. See a [detailed Telnyx vs Twilio comparison](https://telnyx.com/resources/telnyx-vs-twilio-which-voice-api-is-better).

**Q: Do I need multiple vendors for voice, SMS, and AI?**

No. Telnyx provides voice, SMS/MMS, SIP trunking, AI assistants, and IoT SIM management through a single platform and API key.

**Q: Can I use these examples with my existing PBX?**

Yes. The SIP trunking examples show how to connect Telnyx to Asterisk, FreeSWITCH, 3CX, and other PBX systems.

**Q: Is there a free tier?**

Telnyx provides trial credit when you sign up. After that, pricing is pay-as-you-go with no minimums or contracts.

**Q: How do I get help?**

Check the Troubleshooting section in each example, visit [developers.telnyx.com](https://developers.telnyx.com), or reach out to [support@telnyx.com](mailto:support@telnyx.com).

## Contributing

See [CONTRIBUTING.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/CONTRIBUTING.md) for guidelines on adding new examples.

## License

[MIT](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/LICENSE)
