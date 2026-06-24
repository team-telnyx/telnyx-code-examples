# Text To Speech with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that initiates outbound calls and plays text-to-speech (TTS) messages using the Telnyx Voice API. This tutorial demonstrates the Java SDK client initialization pattern, proper error handling for telecom APIs, webhook event processing, and secure credential management via environment variables.

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
- Maven 3.6 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound calls.
- A Call Control Application configured in the Telnyx Portal with a webhook URL.
- A publicly accessible URL for receiving webhooks (use ngrok for local development).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-to-speech-phone-call-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/text-to-speech-phone-call-java
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a Spring Boot application class at `src/main/java/com/telnyx/TtsVoiceApplication.java`:

```java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class TtsVoiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(TtsVoiceApplication.class, args);
    }
}
```

Create a configuration class at `src/main/java/com/telnyx/config/TelnyxConfig.java` to initialize the Telnyx client:

```java
package com.telnyx.config;

import com.telnyx.sdk.TelnyxClient;
import com.telnyx.sdk.TelnyxOkHttpClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TelnyxConfig {
    
    @Value("${telnyx.api.key}")
    private String apiKey;
    
    @Value("${telnyx.phone.number}")
    private String phoneNumber;
    
    @Value("${telnyx.connection.id}")
    private String connectionId;
    
    @Bean
    public TelnyxClient telnyxClient() {
        // Initialize client using the SDK pattern — reads TELNYX_API_KEY from environment
        return TelnyxOkHttpClient.fromEnv();
    }
    
    @Bean
    public TelnyxProperties telnyxProperties() {
        return new TelnyxProperties(apiKey, phoneNumber, connectionId);
    }
}
```

Create a properties holder class at `src/main/java/com/telnyx/config/TelnyxProperties.java`:

```java
package com.telnyx.config;

public class TelnyxProperties {
    private final String apiKey;
    private final String phoneNumber;
    private final String connectionId;
    
    public TelnyxProperties(String apiKey, String phoneNumber, String connectionId) {
        this.apiKey = apiKey;
        this.phoneNumber = phoneNumber;
        this.connectionId = connectionId;
    }
    
    public String getApiKey() {
        return apiKey;
    }
    
    public String getPhoneNumber() {
        return phoneNumber;
    }
    
    public String getConnectionId() {
        return connectionId;
    }
}
```

Create a service class at `src/main/java/com/telnyx/service/VoiceService.java` to handle call initiation and TTS:

```java
package com.telnyx.service;

import com.telnyx.sdk.TelnyxClient;
import com.telnyx.sdk.exception.ApiException;
import com.telnyx.sdk.model.CallControlCommandResponse;
import com.telnyx.sdk.model.CallDialRequest;
import com.telnyx.sdk.model.CallSpeakRequest;
import com.telnyx.config.TelnyxProperties;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class VoiceService {
    
    private final TelnyxClient telnyxClient;
    private final TelnyxProperties telnyxProperties;
    
    public VoiceService(TelnyxClient telnyxClient, TelnyxProperties telnyxProperties) {
        this.telnyxClient = telnyxClient;
        this.telnyxProperties = telnyxProperties;
    }
    
    /**
     * Initiate an outbound call and return the call control ID.
     * The call_control_id is returned in the response and used for subsequent actions.
     */
    public Map<String, Object> initiateCall(String toNumber) throws ApiException {
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException("Phone number must be in E.164 format (e.g., +15551234567)");
        }
        
        CallDialRequest request = new CallDialRequest();
        request.setFrom(telnyxProperties.getPhoneNumber());
        request.setTo(toNumber);
        request.setConnectionId(telnyxProperties.getConnectionId());
        
        // Call the API — returns CallDialResponse with call_control_id
        CallControlCommandResponse response = telnyxClient.calls().dial(request);
        
        // Extract serializable data — SDK objects are NOT JSON-serializable
        Map<String, Object> result = new HashMap<>();
        result.put("call_control_id", response.getData().getCallControlId());
        result.put("from", telnyxProperties.getPhoneNumber());
        result.put("to", toNumber);
        result.put("status", "initiated");
        
        return result;
    }
    
    /**
     * Play text-to-speech message on an active call.
     * Requires the call_control_id from the initiated call.
     */
    public Map<String, Object> playTts(String callControlId, String message) throws ApiException {
        if (message == null || message.trim().isEmpty()) {
            throw new IllegalArgumentException("Message cannot be empty");
        }
        
        CallSpeakRequest request = new CallSpeakRequest();
        request.setPayload(message);
        request.setLanguage("en-US");
        request.setVoice("female");
        
        // Execute the speak action on the call
        CallControlCommandResponse response = telnyxClient.calls().actions().speak(callControlId, request);
        
        // Extract serializable data
        Map<String, Object> result = new HashMap<>();
        result.put("call_control_id", response.getData().getCallControlId());
        result.put("message", message);
        result.put("status", "speaking");
        
        return result;
    }
}
```

Create a REST controller at `src/main/java/com/telnyx/controller/VoiceController.java`:

```java
package com.telnyx.controller;

import com.telnyx.service.VoiceService;
import com.telnyx.sdk.exception.ApiException;
import com.telnyx.sdk.exception.ApiConnectionException;
import com.telnyx.sdk.exception.AuthenticationException;
import com.telnyx.sdk.exception.RateLimitException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/voice")
public class VoiceController {
    
    private final VoiceService voiceService;
    
    public VoiceController(VoiceService voiceService) {
        this.voiceService = voiceService;
    }
    
    /**
     * POST /api/voice/call
     * Initiate an outbound call with TTS.
     * Request body: {"to": "+15559876543", "message": "Hello from Telnyx!"}
     */
    @PostMapping("/call")
    public ResponseEntity<?> initiateCall(@RequestBody Map<String, String> request) {
        String toNumber = request.get("to");
        String message = request.get("message");
        
        if (toNumber == null || toNumber.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'to'"));
        }
        
        if (message == null || message.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'message'"));
        }
        
        try {
            // Initiate the call
            Map<String, Object> callResult = voiceService.initiateCall(toNumber);
            String callControlId = (String) callResult.get("call_control_id");
            
            // Play TTS message on the call
            Map<String, Object> ttsResult = voiceService.playTts(callControlId, message);
            
            // Combine results
            Map<String, Object> response = new HashMap<>();
            response.put("call_control_id", callControlId);
            response.put("to", toNumber);
            response.put("message", message);
            response.put("status", "call_initiated_with_tts");
            
            return ResponseEntity.ok(response);
            
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (RateLimitException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } catch (ApiException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", e.getMessage()));
        } catch (ApiConnectionException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("error", "Network error connecting to Telnyx"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }
    
    /**
     * POST /api/voice/speak/{callControlId}
     * Play TTS message on an existing call.
     * Request body: {"message": "Your message here"}
     */
    @PostMapping("/speak/{callControlId}")
    public ResponseEntity<?> speak(@PathVariable String callControlId, 
                                   @RequestBody Map<String, String> request) {
        String message = request.get("message");
        
        if (message == null || message.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'message'"));
        }
        
        try {
            Map<String, Object> result = voiceService.playTts(callControlId, message);
            return ResponseEntity.ok(result);
            
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (RateLimitException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } catch (ApiException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", e.getMessage()));
        } catch (ApiConnectionException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("error", "Network error connecting to Telnyx"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }
}
```

Create a webhook controller at `src/main/java/com/telnyx/controller/WebhookController.java` to handle call events:

```java
package com.telnyx.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/webhooks")
public class WebhookController {
    
    /**
     * POST /webhooks/voice
     * Receive call control events from Telnyx.
     * Events include: call.initiated, call.answered, call.hangup, call.speak.ended
     */
    @PostMapping("/voice")
    public ResponseEntity<?> handleVoiceEvent(@RequestBody Map<String, Object> payload) {
        // Extract event type from webhook payload
        String eventType = (String) payload.get("data.event_type");
        String callControlId = (String) payload.get("data.call_control_id");
        
        // Log the event (in production, persist to database)
        System.out.println("Received event: " + eventType + " for call: " + callControlId);
        
        // Handle specific events
        if ("call.answered".equals(eventType)) {
            System.out.println("Call answered: " + callControlId);
        } else if ("call.hangup".equals(eventType)) {
            System.out.println("Call ended: " + callControlId);
        } else if ("call.speak.ended".equals(eventType)) {
            System.out.println("TTS playback completed: " + callControlId);
        }
        
        // Return 200 OK to acknowledge receipt
        return ResponseEntity.ok(Map.of("status", "received"));
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/text-to-speech-phone-call-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment and restart the Spring Boot application. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Connection ID Not Found | The API returns an error about an invalid or missing connection ID. | Verify your `TELNYX_CONNECTION_ID` environment variable is set correctly. This is your Call Control Application ID from the Telnyx Portal. Ensure the application is configured with a valid webhook URL and is active. |
| Webhook Events Not Received | Call events are not being logged or processed by the webhook endpoint. | Ensure your webhook URL is publicly accessible and matches the URL configured in your Call Control Application settings in the Telnyx Portal. Use ngrok (`ngrok http 8080`) to expose your local development server and update the webhook URL in the portal. Verify that the Spring Boot application is running and the `/webhooks/voice` endpoint is accessible. |
| TTS Message Not Playing | The call connects but no audio is heard. | Verify the call has been answered before playing TTS. Check that the message text is not empty and is valid UTF-8. Review the webhook events to confirm `call.answered` was received before calling the speak endpoint. Ensure the voice and language parameters are supported (e.g., "female" or "male" for voice, "en-US" for language). |

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

- [Handle Inbound Call Webhooks with Java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/inbound-call-webhook).
- [Record Calls with Java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/call-recording).
- [Transfer Calls with Java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/voice/java/call-transfer).
