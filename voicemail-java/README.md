# Voicemail with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that handles voicemail using the Telnyx Voice API. This tutorial demonstrates how to initiate calls, record voicemail messages, and retrieve recordings using the Telnyx Java SDK with proper error handling and webhook integration for a complete voicemail system.

## Who Is This For?

- **Java developers** building voice features with Spring.
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

- Java 11 or higher.
- Maven 3.6+ or Gradle 6.0+.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound calls.
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).
- Spring Boot 2.7+ installed.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/voicemail-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a configuration class to initialize the Telnyx client:

```java
package com.telnyx.voicemail.config;

import com.telnyx.sdk.TelnyxClient;
import com.telnyx.sdk.TelnyxOkHttpClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TelnyxConfig {

    @Value("${telnyx.api.key}")
    private String apiKey;

    @Bean
    public TelnyxClient telnyxClient() {
        // Initialize client from environment variable
        return TelnyxOkHttpClient.fromEnv();
    }
}
```

Create a service class to handle voicemail operations:

```java
package com.telnyx.voicemail.service;

import com.telnyx.sdk.TelnyxClient;
import com.telnyx.sdk.exception.ApiException;
import com.telnyx.sdk.model.CallControlCommandResponse;
import com.telnyx.sdk.model.CallInitiateRequest;
import com.telnyx.sdk.model.CallRecordingStartRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class VoicemailService {

    @Autowired
    private TelnyxClient telnyxClient;

    @Value("${telnyx.phone.number}")
    private String fromNumber;

    @Value("${telnyx.connection.id}")
    private String connectionId;

    /**
     * Initiate a voicemail call to a specified phone number.
     * Returns the call_control_id for subsequent operations.
     */
    public Map<String, Object> initiateVoicemailCall(String toNumber) throws ApiException {
        // Validate E.164 format
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException("Phone number must be in E.164 format (e.g., +15551234567)");
        }

        // Create call initiation request
        CallInitiateRequest request = new CallInitiateRequest();
        request.setFrom(fromNumber);
        request.setTo(toNumber);
        request.setConnectionId(connectionId);

        // Initiate the call via Telnyx API
        CallControlCommandResponse response = telnyxClient.calls().dial(request);

        // Extract and return serializable data
        return Map.of(
            "call_control_id", response.getData().getCallControlId(),
            "call_state", response.getData().getCallState(),
            "from", fromNumber,
            "to", toNumber
        );
    }

    /**
     * Start recording a voicemail message for an active call.
     */
    public Map<String, Object> startVoicemailRecording(String callControlId) throws ApiException {
        CallRecordingStartRequest request = new CallRecordingStartRequest();
        request.setFormat("wav");
        request.setChannels("single");

        CallControlCommandResponse response = telnyxClient.calls().actions().startRecording(callControlId, request);

        return Map.of(
            "call_control_id", response.getData().getCallControlId(),
            "recording_state", "started"
        );
    }

    /**
     * Stop recording a voicemail message.
     */
    public Map<String, Object> stopVoicemailRecording(String callControlId) throws ApiException {
        CallControlCommandResponse response = telnyxClient.calls().actions().stopRecording(callControlId);

        return Map.of(
            "call_control_id", response.getData().getCallControlId(),
            "recording_state", "stopped"
        );
    }

    /**
     * Hang up a voicemail call.
     */
    public Map<String, Object> hangupCall(String callControlId) throws ApiException {
        CallControlCommandResponse response = telnyxClient.calls().actions().hangup(callControlId);

        return Map.of(
            "call_control_id", response.getData().getCallControlId(),
            "call_state", response.getData().getCallState()
        );
    }
}
```

Create a REST controller to expose voicemail endpoints:

```java
package com.telnyx.voicemail.controller;

import com.telnyx.sdk.exception.ApiException;
import com.telnyx.voicemail.service.VoicemailService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/voicemail")
public class VoicemailController {

    @Autowired
    private VoicemailService voicemailService;

    /**
     * POST /api/voicemail/initiate
     * Initiates a voicemail call to the specified phone number.
     */
    @PostMapping("/initiate")
    public ResponseEntity<?> initiateVoicemail(@RequestBody Map<String, String> request) {
        String toNumber = request.get("to");

        if (toNumber == null || toNumber.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'to'"));
        }

        try {
            Map<String, Object> result = voicemailService.initiateVoicemailCall(toNumber);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        } catch (ApiException e) {
            return handleApiException(e);
        }
    }

    /**
     * POST /api/voicemail/{callControlId}/start-recording
     * Starts recording a voicemail message.
     */
    @PostMapping("/{callControlId}/start-recording")
    public ResponseEntity<?> startRecording(@PathVariable String callControlId) {
        try {
            Map<String, Object> result = voicemailService.startVoicemailRecording(callControlId);
            return ResponseEntity.ok(result);
        } catch (ApiException e) {
            return handleApiException(e);
        }
    }

    /**
     * POST /api/voicemail/{callControlId}/stop-recording
     * Stops recording a voicemail message.
     */
    @PostMapping("/{callControlId}/stop-recording")
    public ResponseEntity<?> stopRecording(@PathVariable String callControlId) {
        try {
            Map<String, Object> result = voicemailService.stopVoicemailRecording(callControlId);
            return ResponseEntity.ok(result);
        } catch (ApiException e) {
            return handleApiException(e);
        }
    }

    /**
     * POST /api/voicemail/{callControlId}/hangup
     * Hangs up a voicemail call.
     */
    @PostMapping("/{callControlId}/hangup")
    public ResponseEntity<?> hangup(@PathVariable String callControlId) {
        try {
            Map<String, Object> result = voicemailService.hangupCall(callControlId);
            return ResponseEntity.ok(result);
        } catch (ApiException e) {
            return handleApiException(e);
        }
    }

    /**
     * POST /webhooks/voice
     * Webhook endpoint to receive call events from Telnyx.
     */
    @PostMapping("/webhooks/voice")
    public ResponseEntity<?> handleVoiceWebhook(@RequestBody Map<String, Object> payload) {
        String eventType = (String) payload.get("event_type");
        Map<String, Object> data = (Map<String, Object>) payload.get("data");

        // Log and handle different call events
        switch (eventType) {
            case "call.initiated":
                handleCallInitiated(data);
                break;
            case "call.answered":
                handleCallAnswered(data);
                break;
            case "call.hangup":
                handleCallHangup(data);
                break;
            case "call.recording.saved":
                handleRecordingSaved(data);
                break;
            default:
                System.out.println("Unhandled event type: " + eventType);
        }

        return ResponseEntity.ok(Map.of("status", "received"));
    }

    private void handleCallInitiated(Map<String, Object> data) {
        String callControlId = (String) data.get("call_control_id");
        System.out.println("Call initiated: " + callControlId);
    }

    private void handleCallAnswered(Map<String, Object> data) {
        String callControlId = (String) data.get("call_control_id");
        System.out.println("Call answered: " + callControlId);
    }

    private void handleCallHangup(Map<String, Object> data) {
        String callControlId = (String) data.get("call_control_id");
        System.out.println("Call hung up: " + callControlId);
    }

    private void handleRecordingSaved(Map<String, Object> data) {
        String recordingUrl = (String) data.get("recording_url");
        System.out.println("Recording saved: " + recordingUrl);
    }

    /**
     * Map Telnyx API exceptions to HTTP status codes.
     */
    private ResponseEntity<?> handleApiException(ApiException e) {
        int statusCode = e.getCode();

        if (statusCode == 401) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } else if (statusCode == 429) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } else if (statusCode >= 400 && statusCode < 500) {
            return ResponseEntity.status(statusCode)
                .body(Map.of("error", e.getMessage(), "status_code", statusCode));
        } else {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("error", "Network error connecting to Telnyx"));
        }
    }
}
```

Create the main Spring Boot application class:

```java
package com.telnyx.voicemail;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class VoicemailApplication {

    public static void main(String[] args) {
        SpringApplication.run(VoicemailApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/voicemail-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Spring Boot application after updating the environment variable. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Connection ID Not Found | The API returns a 422 error indicating the connection ID is invalid or not found. | Verify your `TELNYX_CONNECTION_ID` in the `.env` file corresponds to an active Call Control Application in the [Telnyx Portal](https://portal.telnyx.com). Ensure the connection ID is associated with your Telnyx phone number. If recently created, wait a few moments for propagation. |
| Webhook Events Not Received | Voicemail call events are not triggering the webhook endpoint. | Ensure your `TELNYX_WEBHOOK_URL` is publicly accessible and points to your `/api/voicemail/webhooks/voice` endpoint. Use ngrok or similar tunneling service for local development. Configure the webhook URL in the Telnyx Portal under your Call Control Application settings. Verify firewall rules allow inbound HTTPS traffic on port 443. |
| Recording Not Starting | The `/start-recording` endpoint returns success but no recording is captured. | Ensure the call is in an active state (answered) before starting recording. The call must be answered by the recipient before recording can begin. Check that your Telnyx account has recording permissions enabled. Verify the call hasn't already ended by checking the call state. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Java version do I need?**

Java 17 or higher.

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

- [Handle Inbound Call Webhooks with Java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/inbound-call-webhook).
- [Transfer Calls with Java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/call-transfer).
- [Build an IVR Menu with Java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/ivr-menu).
