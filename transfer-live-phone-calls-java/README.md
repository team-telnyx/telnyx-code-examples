# Call Transfer with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that initiates calls and transfers them to another number using the Telnyx Voice API. This tutorial demonstrates the command-event model of Call Control, proper handling of call state via webhooks, and secure credential management. You'll learn how to initiate outbound calls, listen for call events, and execute transfers programmatically.

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
- A Call Control Application configured in the Telnyx Portal with a webhook URL.
- ngrok or similar tool to expose your local server for webhook testing.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/transfer-live-phone-calls-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/transfer-live-phone-calls-java
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle call operations:

```java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.TelnyxException;
import com.telnyx.model.CallDialResponse;
import com.telnyx.model.CallTransferResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class CallService {
    
    @Autowired
    private TelnyxClient client;
    
    @Value("${TELNYX_PHONE_NUMBER}")
    private String fromNumber;
    
    @Value("${TELNYX_CONNECTION_ID}")
    private String connectionId;
    
    /**
     * Initiate an outbound call.
     * Returns the call_control_id for subsequent control actions.
     */
    public Map<String, String> initiateCall(String toNumber) throws TelnyxException {
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException("Phone number must be in E.164 format (e.g., +15551234567)");
        }
        
        // Use client.calls.dial() to initiate the call
        CallDialResponse response = client.calls.dial(
            fromNumber,
            toNumber,
            connectionId
        );
        
        // Extract serializable data — SDK objects are NOT JSON-serializable
        return Map.of(
            "call_control_id", response.getData().getCallControlId(),
            "from", fromNumber,
            "to", toNumber,
            "status", "initiated"
        );
    }
    
    /**
     * Transfer an active call to another number.
     * Requires the call_control_id from the initiated call.
     */
    public Map<String, String> transferCall(String callControlId, String transferTo) throws TelnyxException {
        if (!transferTo.startsWith("+")) {
            throw new IllegalArgumentException("Transfer number must be in E.164 format");
        }
        
        // Use client.calls.actions.transfer() to transfer the call
        CallTransferResponse response = client.calls.actions.transfer(
            callControlId,
            transferTo
        );
        
        // Extract serializable data
        return Map.of(
            "call_control_id", response.getData().getCallControlId(),
            "transfer_to", transferTo,
            "status", "transfer_initiated"
        );
    }
}
```

Create a REST controller to expose call endpoints:

```java
package com.telnyx.controller;

import com.telnyx.exception.AuthenticationError;
import com.telnyx.exception.RateLimitError;
import com.telnyx.exception.APIStatusError;
import com.telnyx.exception.APIConnectionError;
import com.telnyx.service.CallService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/calls")
public class CallController {
    
    @Autowired
    private CallService callService;
    
    /**
     * POST /calls/initiate
     * Initiates an outbound call.
     * Request body: {"to": "+15559876543"}
     */
    @PostMapping("/initiate")
    public ResponseEntity<?> initiateCall(@RequestBody Map<String, String> request) {
        String toNumber = request.get("to");
        
        if (toNumber == null || toNumber.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'to'"));
        }
        
        try {
            Map<String, String> result = callService.initiateCall(toNumber);
            return ResponseEntity.ok(result);
            
        } catch (AuthenticationError e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (RateLimitError e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } catch (APIStatusError e) {
            return ResponseEntity.status(e.getStatusCode())
                .body(Map.of("error", e.getMessage(), "status_code", String.valueOf(e.getStatusCode())));
        } catch (APIConnectionError e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("error", "Network error connecting to Telnyx"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }
    
    /**
     * POST /calls/transfer
     * Transfers an active call to another number.
     * Request body: {"call_control_id": "...", "transfer_to": "+15551111111"}
     */
    @PostMapping("/transfer")
    public ResponseEntity<?> transferCall(@RequestBody Map<String, String> request) {
        String callControlId = request.get("call_control_id");
        String transferTo = request.get("transfer_to");
        
        if (callControlId == null || callControlId.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'call_control_id'"));
        }
        
        if (transferTo == null || transferTo.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'transfer_to'"));
        }
        
        try {
            Map<String, String> result = callService.transferCall(callControlId, transferTo);
            return ResponseEntity.ok(result);
            
        } catch (AuthenticationError e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (RateLimitError e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } catch (APIStatusError e) {
            return ResponseEntity.status(e.getStatusCode())
                .body(Map.of("error", e.getMessage(), "status_code", String.valueOf(e.getStatusCode())));
        } catch (APIConnectionError e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("error", "Network error connecting to Telnyx"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }
}
```

Create a webhook controller to handle call events:

```java
package com.telnyx.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/webhooks")
public class WebhookController {
    
    /**
     * POST /webhooks/call-events
     * Receives call events from Telnyx (call.initiated, call.answered, call.hangup, etc.).
     * Configure this URL in your Call Control Application settings in the Telnyx Portal.
     */
    @PostMapping("/call-events")
    public ResponseEntity<?> handleCallEvent(@RequestBody Map<String, Object> payload) {
        // Extract event type and call_control_id from webhook payload
        String eventType = (String) payload.get("data.event_type");
        String callControlId = (String) payload.get("data.call_control_id");
        
        // Log the event for debugging
        System.out.println("Received event: " + eventType + " for call: " + callControlId);
        
        // Handle specific events
        if ("call.initiated".equals(eventType)) {
            System.out.println("Call initiated: " + callControlId);
        } else if ("call.answered".equals(eventType)) {
            System.out.println("Call answered: " + callControlId);
        } else if ("call.hangup".equals(eventType)) {
            System.out.println("Call ended: " + callControlId);
        }
        
        // Always return 200 OK to acknowledge receipt
        return ResponseEntity.ok(Map.of("status", "received"));
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/transfer-live-phone-calls-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in `application.properties` matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your configuration file and restart the Spring Boot application. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Events Not Received | The `/webhooks/call-events` endpoint is not receiving call events from Telnyx. | Confirm that ngrok is running and the ngrok URL is correctly configured in your Call Control Application settings in the Telnyx Portal. The webhook URL should be `https://<ngrok-url>/webhooks/call-events`. Verify that your firewall allows inbound HTTPS traffic on port 8080. Check the ngrok logs to confirm requests are being forwarded. |
| Call Transfer Fails with "call_control_id not found" | The transfer endpoint returns an error indicating the call_control_id is invalid or the call has already ended. | Ensure you are using the correct `call_control_id` returned from the initiate call endpoint. The call must be in an active state (answered) before transfer is possible. Wait for the `call.answered` webhook event before attempting a transfer. If the call has ended (received `call.hangup` event), you cannot transfer it. |
| Connection ID Not Set | The application throws an error about missing `TELNYX_CONNECTION_ID` on startup. | Verify that `TELNYX_CONNECTION_ID` is set in your `application.properties` file. This value is your Call Control Application ID from the Telnyx Portal. Restart the Spring Boot application after updating the configuration. |

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

- [Receive Inbound Calls with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/inbound-call-webhook).
- [Record Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/call-recording).
- [Build an IVR Menu](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/ivr-menu).
