# Hold Music with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that places callers on hold with custom music using the Telnyx Voice API. This tutorial demonstrates call control commands, webhook event handling, and proper state management for multi-step call flows. You'll learn to initiate calls, answer them, play hold music, and gracefully handle call lifecycle events.

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
- Maven 3.6+ or Gradle 7.0+.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound calls.
- A publicly accessible URL for webhook callbacks (ngrok, Cloudflare Tunnel, or similar).
- A valid audio file URL (MP3 or WAV) for hold music.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/hold-music-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle call control operations:

```java
package com.telnyx.service;

import com.telnyx.config.TelnyxConfig;
import com.telnyx.exception.TelnyxException;
import com.telnyx.model.CallControlResponse;
import com.telnyx.model.CallDialResponse;
import com.telnyx.rest.TelnyxClient;
import com.telnyx.rest.TelnyxOkHttpClient;
import org.springframework.stereotype.Service;

@Service
public class CallControlService {
    private final TelnyxConfig config;
    private final TelnyxClient client;

    public CallControlService(TelnyxConfig config) {
        this.config = config;
        // Initialize Telnyx client from environment
        this.client = TelnyxOkHttpClient.fromEnv();
    }

    /**
     * Initiate an outbound call and place caller on hold with music.
     * Returns the call_control_id for subsequent control actions.
     */
    public String initiateCallWithHoldMusic(String toNumber) throws TelnyxException {
        try {
            // Dial the call — connection_id is required and static
            CallDialResponse response = client.calls().dial(
                config.phoneNumber,
                toNumber,
                config.connectionId
            );

            // Extract call_control_id from response — this is returned by the API
            String callControlId = response.getData().getCallControlId();

            // Note: The call is now initiated. When answered, we'll play hold music
            // via webhook event handling (see CallWebhookController).
            return callControlId;

        } catch (TelnyxException e) {
            throw new RuntimeException("Failed to initiate call: " + e.getMessage(), e);
        }
    }

    /**
     * Play hold music on an active call.
     * This is typically called after receiving a call.answered webhook event.
     */
    public void playHoldMusic(String callControlId) throws TelnyxException {
        try {
            client.calls().actions().speak(
                callControlId,
                config.holdMusicUrl,
                "audio/mpeg"
            );
        } catch (TelnyxException e) {
            throw new RuntimeException("Failed to play hold music: " + e.getMessage(), e);
        }
    }

    /**
     * Hang up a call gracefully.
     */
    public void hangupCall(String callControlId) throws TelnyxException {
        try {
            client.calls().actions().hangup(callControlId);
        } catch (TelnyxException e) {
            throw new RuntimeException("Failed to hangup call: " + e.getMessage(), e);
        }
    }
}
```

Create a controller to handle outbound call initiation:

```java
package com.telnyx.controller;

import com.telnyx.service.CallControlService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/calls")
public class CallController {
    private final CallControlService callControlService;

    public CallController(CallControlService callControlService) {
        this.callControlService = callControlService;
    }

    /**
     * POST /api/calls/initiate
     * Initiates an outbound call and places the caller on hold with music.
     * Request body: {"to": "+15559876543"}
     */
    @PostMapping("/initiate")
    public ResponseEntity<?> initiateCall(@RequestBody Map<String, String> request) {
        String toNumber = request.get("to");

        if (toNumber == null || toNumber.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'to'"));
        }

        // Validate E.164 format
        if (!toNumber.startsWith("+")) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Phone number must be in E.164 format (e.g., +15551234567)"));
        }

        try {
            String callControlId = callControlService.initiateCallWithHoldMusic(toNumber);
            return ResponseEntity.ok(Map.of(
                "call_control_id", callControlId,
                "status", "initiated",
                "message", "Call initiated. Awaiting answer event."
            ));

        } catch (Exception e) {
            return ResponseEntity.status(500)
                .body(Map.of("error", "Failed to initiate call: " + e.getMessage()));
        }
    }
}
```

Create a webhook controller to handle call events:

```java
package com.telnyx.controller;

import com.telnyx.service.CallControlService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/webhooks")
public class CallWebhookController {
    private final CallControlService callControlService;

    public CallWebhookController(CallControlService callControlService) {
        this.callControlService = callControlService;
    }

    /**
     * POST /webhooks/call
     * Receives call lifecycle events from Telnyx.
     * Events: call.initiated, call.answered, call.hangup, etc.
     */
    @PostMapping("/call")
    public ResponseEntity<?> handleCallEvent(@RequestBody Map<String, Object> payload) {
        try {
            String eventType = (String) payload.get("event_type");
            Map<String, Object> data = (Map<String, Object>) payload.get("data");

            if (data == null) {
                return ResponseEntity.ok(Map.of("status", "received"));
            }

            String callControlId = (String) data.get("call_control_id");

            switch (eventType) {
                case "call.answered":
                    // When the call is answered, play hold music
                    callControlService.playHoldMusic(callControlId);
                    return ResponseEntity.ok(Map.of(
                        "status", "hold_music_started",
                        "call_control_id", callControlId
                    ));

                case "call.hangup":
                    // Call ended — log for cleanup
                    return ResponseEntity.ok(Map.of(
                        "status", "call_ended",
                        "call_control_id", callControlId
                    ));

                case "call.initiated":
                    // Outbound call initiated
                    return ResponseEntity.ok(Map.of(
                        "status", "call_initiated",
                        "call_control_id", callControlId
                    ));

                default:
                    // Acknowledge other events
                    return ResponseEntity.ok(Map.of("status", "event_received"));
            }

        } catch (Exception e) {
            // Log the error but return 200 to prevent Telnyx retries
            System.err.println("Webhook processing error: " + e.getMessage());
            return ResponseEntity.ok(Map.of("status", "error_logged"));
        }
    }
}
```

Create a global exception handler for Telnyx API errors:

```java
package com.telnyx.exception;

import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.APIStatusException;
import com.telnyx.exception.APIConnectionException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

import java.util.Map;

@ControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<?> handleAuthenticationError(AuthenticationException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
            .body(Map.of("error", "Invalid API key: " + e.getMessage()));
    }

    @ExceptionHandler(RateLimitException.class)
    public ResponseEntity<?> handleRateLimitError(RateLimitException e) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
            .body(Map.of("error", "Rate limit exceeded. Please slow down."));
    }

    @ExceptionHandler(APIStatusException.class)
    public ResponseEntity<?> handleAPIStatusError(APIStatusException e) {
        int statusCode = e.getStatusCode();
        return ResponseEntity.status(statusCode)
            .body(Map.of(
                "error", e.getMessage(),
                "status_code", statusCode
            ));
    }

    @ExceptionHandler(APIConnectionException.class)
    public ResponseEntity<?> handleConnectionError(APIConnectionException e) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
            .body(Map.of("error", "Network error connecting to Telnyx: " + e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> handleGenericError(Exception e) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Map.of("error", "Internal server error: " + e.getMessage()));
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/hold-music-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Spring Boot application after updating the environment variable. |
| Webhook Not Receiving Events | Call is initiated but hold music never plays; webhook endpoint shows no incoming requests. | Confirm your webhook URL is publicly accessible and matches the URL configured in the Telnyx Portal under your Call Control Application settings. Use ngrok or a similar tunneling service to expose your local development server. Verify the webhook URL in `application.properties` is correct and restart the application. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Hold Music Not Playing | Call connects but no audio is heard; webhook shows `call.answered` event but hold music fails silently. | Verify the `TELNYX_HOLD_MUSIC_URL` points to a valid, publicly accessible audio file (MP3 or WAV). Test the URL in a browser to confirm it returns audio data. Ensure the audio file is at least a few seconds long. Check application logs for exceptions in the `playHoldMusic()` method. |
| Connection ID Not Found | API returns an error about invalid or missing connection ID. | Confirm your `TELNYX_CONNECTION_ID` environment variable is set to your Call Control Application ID from the Telnyx Portal. This is a static value, not a per-call identifier. Verify it matches exactly (no extra spaces or characters). Restart the application after updating. |

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

- [Handle Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/inbound-call-webhook).
- [Record Calls with Java and Spring](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/call-recording).
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/call-transfer).
