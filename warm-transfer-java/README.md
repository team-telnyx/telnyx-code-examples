# Warm Transfer with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that implements warm transfer—seamlessly moving an active call from one agent to another while keeping the caller connected. This tutorial demonstrates the Telnyx Call Control API's transfer capabilities, webhook event handling, and proper state management for multi-leg calls using the Java SDK.

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
- Two Telnyx phone numbers enabled for inbound and outbound calls.
- A Call Control Application configured in the Telnyx Portal with a webhook URL pointing to your application.
- ngrok or similar tool to expose your local application to the internet for webhook testing.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/warm-transfer-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle warm transfer logic:

```java
package com.telnyx.service;

import com.telnyx.sdk.TelnyxClient;
import com.telnyx.sdk.exception.ApiException;
import com.telnyx.sdk.model.CallControlCommandResponse;
import com.telnyx.sdk.model.CallDialResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class WarmTransferService {

    @Autowired
    private TelnyxClient telnyxClient;

    @Value("${telnyx.phone.number}")
    private String fromNumber;

    @Value("${telnyx.connection.id}")
    private String connectionId;

    @Value("${telnyx.agent.phone}")
    private String agentPhone;

    /**
     * Initiate an outbound call to the agent while keeping the original caller on hold.
     * Returns the call_control_id for the agent leg.
     */
    public Map<String, String> initiateAgentCall(String originalCallControlId) throws ApiException {
        try {
            CallDialResponse response = telnyxClient.calls().dial(
                    fromNumber,
                    agentPhone,
                    connectionId
            );

            // Extract serializable data — SDK objects are NOT JSON-serializable
            return Map.of(
                    "agent_call_control_id", response.getData().getCallControlId(),
                    "original_call_control_id", originalCallControlId
            );
        } catch (ApiException e) {
            throw e;
        }
    }

    /**
     * Transfer the original caller to the agent by bridging the two calls.
     * This completes the warm transfer.
     */
    public Map<String, String> completeTransfer(String originalCallControlId, String agentCallControlId) throws ApiException {
        try {
            // Transfer the original caller to the agent
            CallControlCommandResponse response = telnyxClient.calls().actions().transfer(
                    originalCallControlId,
                    agentCallControlId
            );

            return Map.of(
                    "status", "transferred",
                    "original_call_control_id", originalCallControlId,
                    "agent_call_control_id", agentCallControlId
            );
        } catch (ApiException e) {
            throw e;
        }
    }

    /**
     * Hangup a call by its call_control_id.
     */
    public Map<String, String> hangupCall(String callControlId) throws ApiException {
        try {
            telnyxClient.calls().actions().hangup(callControlId);

            return Map.of(
                    "status", "hung_up",
                    "call_control_id", callControlId
            );
        } catch (ApiException e) {
            throw e;
        }
    }
}
```

Create a controller to handle HTTP endpoints and webhook events:

```java
package com.telnyx.controller;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.telnyx.sdk.exception.ApiException;
import com.telnyx.service.WarmTransferService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/calls")
public class CallController {

    @Autowired
    private WarmTransferService warmTransferService;

    /**
     * Webhook endpoint to receive Telnyx call events.
     * Handles call.initiated, call.answered, call.hangup, etc.
     */
    @PostMapping("/webhook")
    public ResponseEntity<Map<String, String>> handleWebhook(@RequestBody String payload) {
        try {
            JsonObject event = JsonParser.parseString(payload).getAsJsonObject();
            String eventType = event.get("data").getAsJsonObject().get("event_type").getAsString();
            String callControlId = event.get("data").getAsJsonObject().get("call_control_id").getAsString();

            // Log event for debugging
            System.out.println("Received event: " + eventType + " for call: " + callControlId);

            // Handle different call events
            switch (eventType) {
                case "call.initiated":
                    System.out.println("Call initiated: " + callControlId);
                    break;
                case "call.answered":
                    System.out.println("Call answered: " + callControlId);
                    break;
                case "call.hangup":
                    System.out.println("Call hung up: " + callControlId);
                    break;
                default:
                    System.out.println("Unhandled event type: " + eventType);
            }

            return ResponseEntity.ok(Map.of("status", "received"));
        } catch (Exception e) {
            System.err.println("Error processing webhook: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("error", "Failed to process webhook"));
        }
    }

    /**
     * Initiate a warm transfer by calling the agent.
     * Request body: { "original_call_control_id": "..." }
     */
    @PostMapping("/transfer/initiate")
    public ResponseEntity<?> initiateTransfer(@RequestBody Map<String, String> request) {
        String originalCallControlId = request.get("original_call_control_id");

        if (originalCallControlId == null || originalCallControlId.isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing required field: original_call_control_id"));
        }

        try {
            Map<String, String> result = warmTransferService.initiateAgentCall(originalCallControlId);
            return ResponseEntity.ok(result);
        } catch (ApiException e) {
            return handleApiException(e);
        }
    }

    /**
     * Complete the warm transfer by bridging the calls.
     * Request body: { "original_call_control_id": "...", "agent_call_control_id": "..." }
     */
    @PostMapping("/transfer/complete")
    public ResponseEntity<?> completeTransfer(@RequestBody Map<String, String> request) {
        String originalCallControlId = request.get("original_call_control_id");
        String agentCallControlId = request.get("agent_call_control_id");

        if (originalCallControlId == null || originalCallControlId.isEmpty() ||
            agentCallControlId == null || agentCallControlId.isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing required fields: original_call_control_id, agent_call_control_id"));
        }

        try {
            Map<String, String> result = warmTransferService.completeTransfer(originalCallControlId, agentCallControlId);
            return ResponseEntity.ok(result);
        } catch (ApiException e) {
            return handleApiException(e);
        }
    }

    /**
     * Hangup a call.
     * Request body: { "call_control_id": "..." }
     */
    @PostMapping("/hangup")
    public ResponseEntity<?> hangupCall(@RequestBody Map<String, String> request) {
        String callControlId = request.get("call_control_id");

        if (callControlId == null || callControlId.isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing required field: call_control_id"));
        }

        try {
            Map<String, String> result = warmTransferService.hangupCall(callControlId);
            return ResponseEntity.ok(result);
        } catch (ApiException e) {
            return handleApiException(e);
        }
    }

    /**
     * Map Telnyx API exceptions to appropriate HTTP status codes.
     */
    private ResponseEntity<?> handleApiException(ApiException e) {
        if (e.getMessage().contains("401") || e.getMessage().contains("Unauthorized")) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Invalid API key"));
        } else if (e.getMessage().contains("429") || e.getMessage().contains("Rate limit")) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } else if (e.getMessage().contains("503") || e.getMessage().contains("Service unavailable")) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", "Network error connecting to Telnyx"));
        } else {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }
}
```

Create the main Spring Boot application class:

```java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class WarmTransferApplication {

    public static void main(String[] args) {
        SpringApplication.run(WarmTransferApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/warm-transfer-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Spring Boot application after updating the environment variable. |
| Missing Call Control ID | The transfer endpoints return `{"error": "Missing required field: original_call_control_id"}`. | Ensure the request body includes both `original_call_control_id` and `agent_call_control_id` as JSON strings. The `original_call_control_id` is returned from your inbound call webhook; the `agent_call_control_id` is returned from the `/transfer/initiate` endpoint. |
| Webhook Not Receiving Events | The `/api/calls/webhook` endpoint is not being called when calls are made. | Verify that your ngrok URL is correctly configured in the Telnyx Portal's Call Control Application webhook settings. Ensure the webhook URL is `https://your-ngrok-url.ngrok.io/api/calls/webhook`. Check that your firewall allows inbound HTTPS traffic on port 8080. Test the webhook manually using curl to confirm the endpoint is accessible. |
| Transfer Fails with API Error | The `/transfer/complete` endpoint returns a 500 error with a message about the transfer action. | Ensure both calls (original and agent) are in an active state before attempting the transfer. The agent call must be answered before the transfer can complete. Verify that the `call_control_id` values are correct and correspond to active calls. Check the Telnyx Portal logs for detailed error messages. |
| Environment Variables Not Loaded | The application fails to start with `NullPointerException` when accessing `telnyx.phone.number` or other properties. | Confirm that all required environment variables are set: `TELNYX_API_KEY`, `TELNYX_PHONE_NUMBER`, `TELNYX_CONNECTION_ID`, and `TELNYX_AGENT_PHONE`. Use `export` to set them in your shell session before running `mvn spring-boot:run`. Alternatively, create a `.env` file and use a tool like `dotenv-maven-plugin` to load it automatically. |

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

- [Implement an IVR Menu with Java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/ivr-menu).
- [Record Calls with Java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/call-recording).
- [Handle Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/inbound-call-webhook).
