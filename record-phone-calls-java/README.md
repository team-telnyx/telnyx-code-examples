# Call Recording with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that initiates outbound calls and records them using the Telnyx Voice API. This tutorial demonstrates the Java SDK client initialization pattern, webhook handling for recording events, proper error handling for telecom APIs, and secure credential management via environment variables.

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
- A Call Control Application ID (connection_id) configured in the Telnyx Portal.
- A publicly accessible webhook URL (ngrok or similar for local testing).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/record-phone-calls-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/record-phone-calls-java
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a Spring configuration class to initialize the Telnyx client:

```java
package com.telnyx.config;

import com.telnyx.TelnyxClient;
import com.telnyx.TelnyxOkHttpClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TelnyxConfig {
    
    @Bean
    public TelnyxClient telnyxClient() {
        // Initialize client from environment variable TELNYX_API_KEY
        return TelnyxOkHttpClient.fromEnv();
    }
}
```

Create a service class to handle call initiation and recording logic:

```java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import com.telnyx.model.CallDialResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class CallRecordingService {
    
    private final TelnyxClient telnyxClient;
    
    @Value("${telnyx.phone.number}")
    private String fromNumber;
    
    @Value("${telnyx.connection.id}")
    private String connectionId;
    
    @Autowired
    public CallRecordingService(TelnyxClient telnyxClient) {
        this.telnyxClient = telnyxClient;
    }
    
    /**
     * Initiate an outbound call with recording enabled.
     * Returns a map containing the call_control_id for subsequent control actions.
     */
    public Map<String, Object> initiateCallWithRecording(String toNumber) {
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                "Phone number must be in E.164 format (e.g., +15551234567)"
            );
        }
        
        // Prepare call parameters
        Map<String, Object> params = new HashMap<>();
        params.put("from_", fromNumber);
        params.put("to", toNumber);
        params.put("connection_id", connectionId);
        params.put("record", true);  // Enable recording
        params.put("record_format", "wav");  // WAV format for recording
        
        // Initiate the call via Telnyx API
        CallDialResponse response = telnyxClient.calls().dial(params);
        
        // Extract serializable data — SDK objects are NOT JSON-serializable
        Map<String, Object> result = new HashMap<>();
        result.put("call_control_id", response.getData().getCallControlId());
        result.put("from", fromNumber);
        result.put("to", toNumber);
        result.put("recording_enabled", true);
        
        return result;
    }
    
    /**
     * Stop recording for an active call.
     * Returns confirmation of the recording stop action.
     */
    public Map<String, Object> stopRecording(String callControlId) {
        Map<String, Object> params = new HashMap<>();
        params.put("command_id", callControlId);
        
        // Stop the recording
        telnyxClient.calls().actions().stopRecording(callControlId, params);
        
        Map<String, Object> result = new HashMap<>();
        result.put("call_control_id", callControlId);
        result.put("action", "stop_recording");
        result.put("status", "requested");
        
        return result;
    }
}
```

Create a REST controller to expose endpoints for call initiation and webhook handling:

```java
package com.telnyx.controller;

import com.telnyx.service.CallRecordingService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/calls")
public class CallRecordingController {
    
    private final CallRecordingService callRecordingService;
    
    @Autowired
    public CallRecordingController(CallRecordingService callRecordingService) {
        this.callRecordingService = callRecordingService;
    }
    
    /**
     * POST /api/calls/initiate
     * Initiates an outbound call with recording enabled.
     */
    @PostMapping("/initiate")
    public ResponseEntity<?> initiateCall(@RequestBody Map<String, String> request) {
        String toNumber = request.get("to");
        
        if (toNumber == null || toNumber.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'to'"));
        }
        
        try {
            Map<String, Object> result = callRecordingService.initiateCallWithRecording(toNumber);
            return ResponseEntity.ok(result);
            
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }
    
    /**
     * POST /api/calls/{callControlId}/stop-recording
     * Stops recording for an active call.
     */
    @PostMapping("/{callControlId}/stop-recording")
    public ResponseEntity<?> stopRecording(@PathVariable String callControlId) {
        try {
            Map<String, Object> result = callRecordingService.stopRecording(callControlId);
            return ResponseEntity.ok(result);
            
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Failed to stop recording: " + e.getMessage()));
        }
    }
    
    /**
     * POST /api/webhooks/call-events
     * Webhook endpoint to receive call events from Telnyx.
     * Handles call.initiated, call.answered, call.hangup, call.recording.saved events.
     */
    @PostMapping("/webhooks/call-events")
    public ResponseEntity<?> handleCallEvent(@RequestBody Map<String, Object> event) {
        String eventType = (String) event.get("data.event_type");
        String callControlId = (String) event.get("data.call_control_id");
        
        // Log the event for debugging
        System.out.println("Received event: " + eventType + " for call: " + callControlId);
        
        // Handle specific event types
        if ("call.initiated".equals(eventType)) {
            System.out.println("Call initiated: " + callControlId);
        } else if ("call.answered".equals(eventType)) {
            System.out.println("Call answered: " + callControlId);
        } else if ("call.recording.saved".equals(eventType)) {
            String recordingUrl = (String) event.get("data.recording_urls.0");
            System.out.println("Recording saved for call " + callControlId + ": " + recordingUrl);
        } else if ("call.hangup".equals(eventType)) {
            System.out.println("Call ended: " + callControlId);
        }
        
        // Return 200 OK to acknowledge receipt
        return ResponseEntity.ok(Map.of("status", "received"));
    }
}
```

Create a global exception handler for Telnyx API errors:

```java
package com.telnyx.exception;

import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
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
    
    @ExceptionHandler(TelnyxException.class)
    public ResponseEntity<?> handleTelnyxError(TelnyxException e) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
            .body(Map.of("error", "Telnyx API error: " + e.getMessage()));
    }
    
    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> handleGenericError(Exception e) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Map.of("error", "Internal server error: " + e.getMessage()));
    }
}
```

Create the main Spring Boot application class:

```java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class CallRecordingApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(CallRecordingApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment variable and restart the Spring Boot application. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Connection ID Not Set | The application raises an error about missing `TELNYX_CONNECTION_ID` or the call fails with "invalid connection_id". | Verify your `TELNYX_CONNECTION_ID` environment variable is set and matches a valid Call Control Application ID from the Telnyx Portal. The connection_id links your phone number to a Call Control application—ensure this application is configured and active. |
| Webhook Events Not Received | The webhook endpoint is not receiving events from Telnyx even though calls are being initiated. | Ensure your webhook URL is publicly accessible (use ngrok for local testing). Update your Call Control Application settings in the Telnyx Portal to point to your webhook URL. Verify the URL format is correct: `https://<your-domain>/api/calls/webhooks/call-events`. Check application logs for incoming requests. |
| Recording Not Starting | Calls are initiated but recordings are not being saved. | Verify that the `record` parameter is set to `true` in the `initiateCallWithRecording()` method. Check that your Telnyx account has recording enabled and that you have sufficient credits. Review webhook events for `call.recording.saved` to confirm recording completion. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this Voice example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/call-transfer).
- [Build an IVR Menu System](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/ivr-menu).
