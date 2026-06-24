# Call Forwarding with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that implements intelligent call forwarding using the Telnyx Voice API. This tutorial demonstrates how to initiate outbound calls, handle webhook events, and transfer calls between numbers using the Telnyx Java SDK. You'll learn the command-event model that powers Telnyx Call Control, proper error handling for telecom APIs, and secure credential management via environment variables.

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
cd telnyx-code-examples/call-forwarding-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-forwarding-java
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle call forwarding logic:

```java
package com.telnyx.callforwarding.service;

import com.telnyx.TelnyxClient;
import com.telnyx.TelnyxOkHttpClient;
import com.telnyx.exception.APIConnectionException;
import com.telnyx.exception.APIException;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.model.CallControlResponse;
import com.telnyx.callforwarding.config.TelnyxProperties;
import org.springframework.stereotype.Service;
import java.util.HashMap;
import java.util.Map;

@Service
public class CallForwardingService {
    
    private final TelnyxClient client;
    private final TelnyxProperties telnyxProperties;
    
    public CallForwardingService(TelnyxProperties telnyxProperties) {
        this.telnyxProperties = telnyxProperties;
        // Initialize Telnyx client from environment variables
        this.client = TelnyxOkHttpClient.fromEnv();
    }
    
    /**
     * Initiate an outbound call from the Telnyx number to a destination.
     * Returns the call_control_id for subsequent control actions.
     */
    public Map<String, String> initiateCall(String toNumber) throws APIException {
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                "Phone number must be in E.164 format (e.g., +15551234567)"
            );
        }
        
        try {
            // Use client.calls().dial() to initiate the call
            // connection_id is the Call Control Application ID (static config)
            // call_control_id is returned in the response (per-call runtime value)
            CallControlResponse response = client.calls().dial(
                telnyxProperties.getPhoneNumber(),  // from_
                toNumber,                            // to
                telnyxProperties.getConnectionId()   // connection_id
            );
            
            // Extract serializable data — SDK objects are NOT JSON-serializable
            Map<String, String> result = new HashMap<>();
            result.put("call_control_id", response.getData().getCallControlId());
            result.put("from", telnyxProperties.getPhoneNumber());
            result.put("to", toNumber);
            result.put("status", "initiated");
            
            return result;
            
        } catch (AuthenticationException e) {
            throw new AuthenticationException("Invalid Telnyx API key", e);
        } catch (RateLimitException e) {
            throw new RateLimitException("Rate limit exceeded", e);
        } catch (APIConnectionException e) {
            throw new APIConnectionException("Network error connecting to Telnyx", e);
        }
    }
    
    /**
     * Transfer an active call to a new destination.
     * Requires the call_control_id from the initiated call.
     */
    public Map<String, String> transferCall(String callControlId, String transferTo) 
            throws APIException {
        if (!transferTo.startsWith("+")) {
            throw new IllegalArgumentException(
                "Transfer number must be in E.164 format (e.g., +15551234567)"
            );
        }
        
        try {
            // Use client.calls().actions().transfer() to transfer the call
            CallControlResponse response = client.calls().actions().transfer(
                callControlId,
                transferTo
            );
            
            Map<String, String> result = new HashMap<>();
            result.put("call_control_id", response.getData().getCallControlId());
            result.put("transfer_to", transferTo);
            result.put("status", "transfer_initiated");
            
            return result;
            
        } catch (AuthenticationException e) {
            throw new AuthenticationException("Invalid Telnyx API key", e);
        } catch (RateLimitException e) {
            throw new RateLimitException("Rate limit exceeded", e);
        } catch (APIConnectionException e) {
            throw new APIConnectionException("Network error connecting to Telnyx", e);
        }
    }
    
    /**
     * Hang up an active call.
     * Requires the call_control_id from the initiated call.
     */
    public Map<String, String> hangupCall(String callControlId) throws APIException {
        try {
            CallControlResponse response = client.calls().actions().hangup(callControlId);
            
            Map<String, String> result = new HashMap<>();
            result.put("call_control_id", response.getData().getCallControlId());
            result.put("status", "hangup_initiated");
            
            return result;
            
        } catch (AuthenticationException e) {
            throw new AuthenticationException("Invalid Telnyx API key", e);
        } catch (RateLimitException e) {
            throw new RateLimitException("Rate limit exceeded", e);
        } catch (APIConnectionException e) {
            throw new APIConnectionException("Network error connecting to Telnyx", e);
        }
    }
}
```

Create a REST controller to expose call forwarding endpoints:

```java
package com.telnyx.callforwarding.controller;

import com.telnyx.exception.APIException;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.callforwarding.service.CallForwardingService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/calls")
public class CallForwardingController {
    
    private final CallForwardingService callForwardingService;
    
    public CallForwardingController(CallForwardingService callForwardingService) {
        this.callForwardingService = callForwardingService;
    }
    
    /**
     * POST /api/calls/initiate
     * Initiates an outbound call to the specified number.
     */
    @PostMapping("/initiate")
    public ResponseEntity<?> initiateCall(@RequestBody Map<String, String> request) {
        String toNumber = request.get("to");
        
        if (toNumber == null || toNumber.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'to'"));
        }
        
        try {
            Map<String, String> result = callForwardingService.initiateCall(toNumber);
            return ResponseEntity.ok(result);
            
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (RateLimitException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } catch (APIException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(Map.of("error", "Telnyx API error: " + e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }
    
    /**
     * POST /api/calls/{callControlId}/transfer
     * Transfers an active call to a new destination.
     */
    @PostMapping("/{callControlId}/transfer")
    public ResponseEntity<?> transferCall(
            @PathVariable String callControlId,
            @RequestBody Map<String, String> request) {
        String transferTo = request.get("transfer_to");
        
        if (transferTo == null || transferTo.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'transfer_to'"));
        }
        
        try {
            Map<String, String> result = callForwardingService.transferCall(
                callControlId, 
                transferTo
            );
            return ResponseEntity.ok(result);
            
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (RateLimitException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } catch (APIException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(Map.of("error", "Telnyx API error: " + e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }
    
    /**
     * POST /api/calls/{callControlId}/hangup
     * Terminates an active call.
     */
    @PostMapping("/{callControlId}/hangup")
    public ResponseEntity<?> hangupCall(@PathVariable String callControlId) {
        try {
            Map<String, String> result = callForwardingService.hangupCall(callControlId);
            return ResponseEntity.ok(result);
            
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (RateLimitException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } catch (APIException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(Map.of("error", "Telnyx API error: " + e.getMessage()));
        }
    }
}
```

Create a webhook controller to handle Telnyx call events:

```java
package com.telnyx.callforwarding.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@RestController
@RequestMapping("/webhooks")
public class WebhookController {
    
    private static final Logger logger = LoggerFactory.getLogger(WebhookController.class);
    
    /**
     * POST /webhooks/call-events
     * Receives call control events from Telnyx.
     * Configure this URL in your Call Control Application settings.
     */
    @PostMapping("/call-events")
    public ResponseEntity<?> handleCallEvent(@RequestBody Map<String, Object> payload) {
        String eventType = (String) payload.get("data.event_type");
        String callControlId = (String) payload.get("data.call_control_id");
        
        logger.info("Received event: {} for call: {}", eventType, callControlId);
        
        // Handle different call events
        if ("call.initiated".equals(eventType)) {
            logger.info("Call initiated: {}", callControlId);
        } else if ("call.answered".equals(eventType)) {
            logger.info("Call answered: {}", callControlId);
        } else if ("call.hangup".equals(eventType)) {
            logger.info("Call ended: {}", callControlId);
        } else if ("call.dtmf.received".equals(eventType)) {
            String digit = (String) payload.get("data.dtmf_digit");
            logger.info("DTMF digit received: {} for call: {}", digit, callControlId);
        }
        
        // Always return 200 OK to acknowledge receipt
        return ResponseEntity.ok(Map.of("status", "received"));
    }
}
```

Create the main Spring Boot application class:

```java
package com.telnyx.callforwarding;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class CallForwardingApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(CallForwardingApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-forwarding-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Spring Boot application after updating the environment variable. Confirm the `.env` file is in the project root and `mvn spring-boot:run` is loading it correctly. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl requests to use properly formatted numbers. Verify the `TELNYX_PHONE_NUMBER` in your `.env` file is also in E.164 format. |
| Connection ID Not Found | The API returns an error about an invalid or missing connection ID. | Verify your `TELNYX_CONNECTION_ID` in the `.env` file matches your Call Control Application ID from the Telnyx Portal. The connection ID links your phone number to a Call Control application. If you haven't created a Call Control Application yet, create one in the Portal and copy its ID. Restart the application after updating the environment variable. |
| Webhook Events Not Received | You initiate a call but don't see webhook events in your application logs. | Expose your local server using ngrok: `ngrok http 8080`. Copy the ngrok URL and configure it in your Call Control Application settings in the Telnyx Portal. Set the webhook URL to `https://<your-ngrok-url>/webhooks/call-events`. Ensure the URL is publicly accessible and returns HTTP 200 OK. Check your ngrok dashboard to verify requests are being received. |
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | You are making too many API requests in a short time. Implement exponential backoff in your client code or reduce the frequency of API calls. Telnyx rate limits vary by endpoint; check the [API documentation](https://developers.telnyx.com) for specific limits. Wait a few seconds before retrying the request. |

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

- [Inbound Call Webhook Handler](/tutorials/voice/java/inbound-call-webhook).
- [Call Recording with Java and Spring](/tutorials/voice/java/call-recording).
- [Build an IVR Menu with Java and Spring](/tutorials/voice/java/ivr-menu).
