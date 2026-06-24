# Whisper Prompt with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that initiates outbound calls with whisper prompts using the Telnyx Voice API. A whisper prompt is a message played to the caller before the call is connected to the recipient, enabling you to inform callers of the call's purpose or provide instructions. This tutorial demonstrates call initiation, webhook handling for call events, and proper error handling for telecom APIs.

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
- A publicly accessible URL for receiving webhooks (use ngrok for local development).
- Spring Boot 2.7+ or 3.0+.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-whisper-monitoring-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create the main Spring Boot application class:

```java
package com.telnyx.whisper;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class WhisperPromptApplication {
    public static void main(String[] args) {
        SpringApplication.run(WhisperPromptApplication.class, args);
    }
}
```

Create a configuration class to initialize the Telnyx client:

```java
package com.telnyx.whisper.config;

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

Create a service class to handle call initiation with whisper prompts:

```java
package com.telnyx.whisper.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.APIConnectionException;
import com.telnyx.exception.APIException;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.model.CallControlApplication;
import com.telnyx.model.CallDialResponse;
import com.telnyx.net.RequestOptions;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class WhisperPromptService {
    
    private final TelnyxClient telnyxClient;
    
    @Value("${TELNYX_PHONE_NUMBER}")
    private String fromNumber;
    
    @Value("${TELNYX_CONNECTION_ID}")
    private String connectionId;
    
    @Autowired
    public WhisperPromptService(TelnyxClient telnyxClient) {
        this.telnyxClient = telnyxClient;
    }
    
    /**
     * Initiate an outbound call with a whisper prompt.
     * The whisper prompt is played to the caller before the call connects.
     * 
     * @param toNumber Recipient phone number in E.164 format (e.g., +15559876543)
     * @param whisperText Text to be spoken as the whisper prompt
     * @return Map containing call_control_id and other call metadata
     * @throws IllegalArgumentException if phone number format is invalid
     */
    public Map<String, Object> initiateCallWithWhisper(String toNumber, String whisperText) 
            throws AuthenticationException, APIException, APIConnectionException {
        
        // Validate E.164 format to prevent API errors
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                "Phone number must be in E.164 format (e.g., +15559876543)"
            );
        }
        
        if (whisperText == null || whisperText.trim().isEmpty()) {
            throw new IllegalArgumentException("Whisper text cannot be empty");
        }
        
        // Build request parameters for call initiation
        Map<String, Object> params = new HashMap<>();
        params.put("from_", fromNumber);
        params.put("to", toNumber);
        params.put("connection_id", connectionId);
        params.put("custom_headers", new HashMap<String, String>() {{
            put("X-Whisper-Prompt", whisperText);
        }});
        
        // Initiate the call via Telnyx API
        // The call_control_id is returned in the response and used for subsequent actions
        CallDialResponse response = telnyxClient.calls().dial(params);
        
        // Extract serializable data — SDK objects are NOT JSON-serializable
        return Map.of(
            "call_control_id", response.getData().getCallControlId(),
            "from", fromNumber,
            "to", toNumber,
            "state", response.getData().getState(),
            "whisper_prompt", whisperText
        );
    }
}
```

Create a REST controller to expose the whisper prompt endpoint:

```java
package com.telnyx.whisper.controller;

import com.telnyx.exception.APIConnectionException;
import com.telnyx.exception.APIException;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.whisper.service.WhisperPromptService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/calls")
public class CallController {
    
    private final WhisperPromptService whisperPromptService;
    
    @Autowired
    public CallController(WhisperPromptService whisperPromptService) {
        this.whisperPromptService = whisperPromptService;
    }
    
    /**
     * POST /api/calls/initiate-with-whisper
     * Initiates an outbound call with a whisper prompt.
     * 
     * Request body:
     * {
     *   "to": "+15559876543",
     *   "whisper_text": "This is a call from Acme Corp. Press 1 to accept."
     * }
     */
    @PostMapping("/initiate-with-whisper")
    public ResponseEntity<?> initiateCallWithWhisper(@RequestBody Map<String, String> request) {
        String toNumber = request.get("to");
        String whisperText = request.get("whisper_text");
        
        // Validate request payload
        if (toNumber == null || toNumber.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'to'"));
        }
        
        if (whisperText == null || whisperText.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'whisper_text'"));
        }
        
        try {
            Map<String, Object> result = whisperPromptService.initiateCallWithWhisper(
                toNumber, 
                whisperText
            );
            return ResponseEntity.ok(result);
            
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (APIException e) {
            // Handle rate limiting and other API errors
            if (e.getMessage().contains("429")) {
                return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Rate limit exceeded. Please slow down."));
            }
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", e.getMessage()));
        } catch (APIConnectionException e) {
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
package com.telnyx.whisper.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/webhooks")
public class WebhookController {
    
    /**
     * POST /webhooks/call
     * Receives call control events from Telnyx.
     * Events include: call.initiated, call.answered, call.hangup, etc.
     */
    @PostMapping("/call")
    public ResponseEntity<?> handleCallEvent(@RequestBody Map<String, Object> payload) {
        // Extract event type and call control ID
        String eventType = (String) payload.get("event_type");
        Map<String, Object> data = (Map<String, Object>) payload.get("data");
        
        if (data == null) {
            return ResponseEntity.ok(Map.of("status", "received"));
        }
        
        String callControlId = (String) data.get("call_control_id");
        
        // Log and handle different event types
        switch (eventType) {
            case "call.initiated":
                handleCallInitiated(callControlId, data);
                break;
            case "call.answered":
                handleCallAnswered(callControlId, data);
                break;
            case "call.hangup":
                handleCallHangup(callControlId, data);
                break;
            default:
                System.out.println("Unhandled event type: " + eventType);
        }
        
        // Always return 200 OK to acknowledge receipt
        return ResponseEntity.ok(Map.of("status", "received"));
    }
    
    private void handleCallInitiated(String callControlId, Map<String, Object> data) {
        System.out.println("Call initiated: " + callControlId);
        System.out.println("From: " + data.get("from"));
        System.out.println("To: " + data.get("to"));
    }
    
    private void handleCallAnswered(String callControlId, Map<String, Object> data) {
        System.out.println("Call answered: " + callControlId);
        // Whisper prompt would be played here if configured
    }
    
    private void handleCallHangup(String callControlId, Map<String, Object> data) {
        System.out.println("Call ended: " + callControlId);
        System.out.println("Hangup reason: " + data.get("hangup_reason"));
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/call-whisper-monitoring-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in `application.properties` matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your configuration file and restart the Spring Boot application. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Events Not Received | The webhook controller is not receiving call events from Telnyx. | Verify that your Call Control Application webhook URL in the Telnyx Portal points to your public URL (e.g., `https://abc123.ngrok.io/webhooks/call`). Ensure the URL is publicly accessible and your firewall allows inbound HTTPS traffic. Check application logs for incoming POST requests to `/webhooks/call`. |
| Connection ID Not Found | The API returns an error about an invalid or missing connection ID. | Confirm that `TELNYX_CONNECTION_ID` in `application.properties` matches your Call Control Application ID from the Telnyx Portal. The connection ID links your phone number to the Call Control application and must be configured correctly. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Implement exponential backoff retry logic in your application. Telnyx enforces rate limits to ensure fair API usage. Space out your call initiation requests and consider implementing a queue for high-volume scenarios. |

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

- [Handle Inbound Call Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/inbound-call-webhook).
- [Record and Store Call Audio](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/call-recording).
- [Transfer Calls Between Numbers](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/call-transfer).
