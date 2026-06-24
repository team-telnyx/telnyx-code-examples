# Inbound Call Webhook with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that receives and processes inbound call webhooks from the Telnyx Voice API. This tutorial demonstrates webhook endpoint setup, secure credential management via environment variables, and proper handling of call lifecycle events (initiated, answered, hangup).

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
- A Telnyx phone number configured with a Call Control Application.
- A publicly accessible URL (ngrok, Cloudflare Tunnel, or deployed server) to receive webhooks.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/route-phone-calls-to-ai-agent-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/route-phone-calls-to-ai-agent-java
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create the main Spring Boot application class at `src/main/java/com/telnyx/InboundCallWebhookApplication.java`:

```java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class InboundCallWebhookApplication {
    public static void main(String[] args) {
        SpringApplication.run(InboundCallWebhookApplication.class, args);
    }
}
```

Create a webhook controller at `src/main/java/com/telnyx/controller/WebhookController.java`:

```java
package com.telnyx.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/webhooks")
public class WebhookController {
    private static final Logger logger = LoggerFactory.getLogger(WebhookController.class);

    /**
     * Receive inbound call webhooks from Telnyx.
     * Handles call.initiated, call.answered, and call.hangup events.
     */
    @PostMapping("/call")
    public ResponseEntity<Map<String, String>> handleCallWebhook(@RequestBody Map<String, Object> payload) {
        try {
            // Extract event data from webhook payload
            Map<String, Object> data = (Map<String, Object>) payload.get("data");
            String eventType = (String) payload.get("type");
            String callControlId = (String) data.get("call_control_id");
            String from = (String) data.get("from");
            String to = (String) data.get("to");

            logger.info("Received webhook event: {} for call: {}", eventType, callControlId);

            // Handle different call lifecycle events
            switch (eventType) {
                case "call.initiated":
                    handleCallInitiated(callControlId, from, to);
                    break;
                case "call.answered":
                    handleCallAnswered(callControlId);
                    break;
                case "call.hangup":
                    handleCallHangup(callControlId);
                    break;
                default:
                    logger.warn("Unknown event type: {}", eventType);
            }

            // Return 200 OK to acknowledge receipt
            return ResponseEntity.ok(Map.of("status", "received"));

        } catch (Exception e) {
            logger.error("Error processing webhook", e);
            return ResponseEntity.status(500).body(Map.of("error", "Internal server error"));
        }
    }

    /**
     * Handle call.initiated event — inbound call has started.
     */
    private void handleCallInitiated(String callControlId, String from, String to) {
        logger.info("Call initiated: {} from {} to {}", callControlId, from, to);
        // Store call metadata in database or cache for later reference
        // Example: save to CallRepository or in-memory store
    }

    /**
     * Handle call.answered event — call has been connected.
     */
    private void handleCallAnswered(String callControlId) {
        logger.info("Call answered: {}", callControlId);
        // Trigger call recording, IVR menu, or other logic
    }

    /**
     * Handle call.hangup event — call has ended.
     */
    private void handleCallHangup(String callControlId) {
        logger.info("Call hangup: {}", callControlId);
        // Clean up resources, finalize call logs, stop recording
    }
}
```

Create a service class at `src/main/java/com/telnyx/service/CallService.java` to encapsulate call control logic:

```java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.TelnyxOkHttpClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class CallService {
    private static final Logger logger = LoggerFactory.getLogger(CallService.class);
    private final TelnyxClient client;

    public CallService() {
        // Initialize Telnyx client from environment variables
        this.client = TelnyxOkHttpClient.fromEnv();
    }

    /**
     * Retrieve call status by call control ID.
     * Returns a map with call metadata for logging or decision-making.
     */
    public Map<String, Object> getCallStatus(String callControlId) {
        try {
            var response = client.calls().retrieveStatus(callControlId);
            var callData = response.getData();

            return Map.of(
                "call_control_id", callData.getCallControlId(),
                "is_alive", callData.getIsAlive(),
                "state", callData.getState() != null ? callData.getState().toString() : "unknown"
            );
        } catch (Exception e) {
            logger.error("Error retrieving call status for {}: {}", callControlId, e.getMessage());
            throw new RuntimeException("Failed to retrieve call status", e);
        }
    }

    /**
     * Answer an inbound call.
     */
    public void answerCall(String callControlId) {
        try {
            client.calls().actions().answer(callControlId);
            logger.info("Answered call: {}", callControlId);
        } catch (Exception e) {
            logger.error("Error answering call {}: {}", callControlId, e.getMessage());
            throw new RuntimeException("Failed to answer call", e);
        }
    }

    /**
     * Hangup a call.
     */
    public void hangupCall(String callControlId) {
        try {
            client.calls().actions().hangup(callControlId);
            logger.info("Hung up call: {}", callControlId);
        } catch (Exception e) {
            logger.error("Error hanging up call {}: {}", callControlId, e.getMessage());
            throw new RuntimeException("Failed to hangup call", e);
        }
    }
}
```

Create a global exception handler at `src/main/java/com/telnyx/exception/GlobalExceptionHandler.java`:

```java
package com.telnyx.exception;

import com.telnyx.exception.api.ApiException;
import com.telnyx.exception.api.AuthenticationException;
import com.telnyx.exception.api.RateLimitException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

import java.util.Map;

@ControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger logger = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<Map<String, String>> handleAuthenticationError(AuthenticationException e) {
        logger.error("Authentication error: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
            .body(Map.of("error", "Invalid API key"));
    }

    @ExceptionHandler(RateLimitException.class)
    public ResponseEntity<Map<String, String>> handleRateLimitError(RateLimitException e) {
        logger.error("Rate limit exceeded: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
            .body(Map.of("error", "Rate limit exceeded. Please slow down."));
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, String>> handleApiError(ApiException e) {
        logger.error("API error: {}", e.getMessage());
        int statusCode = e.getStatusCode() != null ? e.getStatusCode() : 500;
        return ResponseEntity.status(statusCode)
            .body(Map.of("error", e.getMessage(), "status_code", String.valueOf(statusCode)));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleGenericError(Exception e) {
        logger.error("Unexpected error", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Map.of("error", "Internal server error"));
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/route-phone-calls-to-ai-agent-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not received | The endpoint is running but Telnyx is not sending webhook events. | Verify that your Call Control Application in the [Telnyx Portal](https://portal.telnyx.com) has the webhook URL configured correctly. Ensure the URL is publicly accessible (test with curl from another machine). Check that your ngrok tunnel is still active and the URL matches exactly. Verify that the phone number is assigned to the correct Call Control Application. |
| Authentication error (401) | The application logs show `AuthenticationException` when calling Telnyx APIs. | Confirm that the `TELNYX_API_KEY` environment variable is set correctly and matches your API key from the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or special characters in the key. Restart the Spring Boot application after updating environment variables. |
| Webhook payload parsing error | The application throws a `ClassCastException` or `NullPointerException` when processing webhook data. | Verify that the webhook payload structure matches the expected format. Log the raw payload using `logger.info("Payload: {}", payload)` to inspect the actual data structure. Ensure that all expected fields (`type`, `data`, `call_control_id`) are present in the webhook payload. Check the Telnyx documentation for the correct webhook event schema. |
| Port already in use | The application fails to start with `Address already in use` error. | Change the server port in `application.properties` to an available port (e.g., `server.port=8081`). Alternatively, kill the process using the current port with `lsof -i :8080` and `kill -9 <PID>`. |

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

- [Initiate an Outbound Call](/tutorials/voice/java/outbound-call).
- [Record a Call](/tutorials/voice/java/call-recording).
- [Transfer a Call](/tutorials/voice/java/call-transfer).
