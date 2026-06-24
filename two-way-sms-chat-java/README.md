# Two Way SMS with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that sends and receives SMS messages using the Telnyx Java SDK. This tutorial demonstrates bidirectional SMS communication: outbound message delivery with status tracking and inbound message handling via webhooks. You'll learn proper error handling for telecom APIs, secure credential management, and webhook validation patterns essential for production messaging systems.

## Who Is This For?

- **Java developers** building sms features with Spring.
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
- A Telnyx phone number enabled for SMS (inbound and outbound).
- A publicly accessible URL for webhook delivery (ngrok, Cloudflare Tunnel, or deployed server).
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-java
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
        // Initialize client from TELNYX_API_KEY environment variable
        return TelnyxOkHttpClient.fromEnv();
    }
}
```

Create a service class to handle SMS operations:

```java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import com.telnyx.model.Message;
import com.telnyx.model.MessageCreateRequest;
import com.telnyx.model.MessageCreateResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class SmsService {
    
    @Autowired
    private TelnyxClient telnyxClient;
    
    @Value("${telnyx.phone.number}")
    private String fromNumber;
    
    /**
     * Send an SMS message and return JSON-serializable response data.
     * Validates phone number format and handles API errors.
     */
    public Map<String, Object> sendSms(String toNumber, String messageText) throws TelnyxException {
        if (toNumber == null || !toNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                "Phone number must be in E.164 format (e.g., +15551234567)"
            );
        }
        
        if (messageText == null || messageText.trim().isEmpty()) {
            throw new IllegalArgumentException("Message text cannot be empty");
        }
        
        // Create message request using the SDK
        MessageCreateRequest request = new MessageCreateRequest()
            .setFrom(fromNumber)
            .setTo(toNumber)
            .setText(messageText);
        
        // Call Telnyx API — exceptions are caught in the controller
        MessageCreateResponse response = telnyxClient.messages().create(request);
        
        // Extract serializable data — SDK objects are NOT JSON-serializable
        Map<String, Object> result = new HashMap<>();
        result.put("message_id", response.getData().getId());
        result.put("status", response.getData().getTo() != null && !response.getData().getTo().isEmpty()
            ? response.getData().getTo().get(0).getStatus()
            : "unknown");
        result.put("from", fromNumber);
        result.put("to", toNumber);
        result.put("direction", "outbound");
        
        return result;
    }
}
```

Create a REST controller to handle inbound and outbound SMS:

```java
package com.telnyx.controller;

import com.telnyx.service.SmsService;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/sms")
public class SmsController {
    
    @Autowired
    private SmsService smsService;
    
    /**
     * POST /sms/send — Send an outbound SMS message.
     * Request body: {"to": "+15559876543", "message": "Hello from Telnyx!"}
     */
    @PostMapping("/send")
    public ResponseEntity<?> sendSms(@RequestBody Map<String, String> payload) {
        String toNumber = payload.get("to");
        String messageText = payload.get("message");
        
        if (toNumber == null || messageText == null) {
            Map<String, String> error = new HashMap<>();
            error.put("error", "Missing required fields: 'to' and 'message'");
            return ResponseEntity.badRequest().body(error);
        }
        
        try {
            Map<String, Object> result = smsService.sendSms(toNumber, messageText);
            return ResponseEntity.ok(result);
            
        } catch (IllegalArgumentException e) {
            Map<String, String> error = new HashMap<>();
            error.put("error", e.getMessage());
            return ResponseEntity.badRequest().body(error);
        } catch (AuthenticationException e) {
            Map<String, String> error = new HashMap<>();
            error.put("error", "Invalid API key");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error);
        } catch (RateLimitException e) {
            Map<String, String> error = new HashMap<>();
            error.put("error", "Rate limit exceeded. Please slow down.");
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(error);
        } catch (TelnyxException e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", e.getMessage());
            error.put("status_code", 500);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
        }
    }
    
    /**
     * POST /sms/webhook — Receive inbound SMS and delivery status updates.
     * Telnyx sends webhook events for message.received and message.finalized.
     */
    @PostMapping("/webhook")
    public ResponseEntity<?> handleWebhook(@RequestBody Map<String, Object> payload) {
        // Extract event type from webhook payload
        String eventType = (String) payload.get("type");
        
        if ("message.received".equals(eventType)) {
            // Handle inbound SMS
            Map<String, Object> data = (Map<String, Object>) payload.get("data");
            String messageId = (String) data.get("id");
            String from = (String) data.get("from");
            String text = (String) data.get("text");
            
            System.out.println("Inbound SMS received:");
            System.out.println("  Message ID: " + messageId);
            System.out.println("  From: " + from);
            System.out.println("  Text: " + text);
            
            // Process inbound message (e.g., store in database, trigger business logic)
            // For this example, we simply log and acknowledge receipt
            
        } else if ("message.finalized".equals(eventType)) {
            // Handle delivery status update
            Map<String, Object> data = (Map<String, Object>) payload.get("data");
            String messageId = (String) data.get("id");
            String direction = (String) data.get("direction");
            
            System.out.println("Message status update:");
            System.out.println("  Message ID: " + messageId);
            System.out.println("  Direction: " + direction);
            
            // Extract delivery status from the 'to' array
            if (data.containsKey("to") && data.get("to") instanceof java.util.List) {
                java.util.List<Map<String, Object>> toList = 
                    (java.util.List<Map<String, Object>>) data.get("to");
                if (!toList.isEmpty()) {
                    String status = (String) toList.get(0).get("status");
                    System.out.println("  Status: " + status);
                }
            }
        }
        
        // Always return 200 OK to acknowledge webhook receipt
        Map<String, String> response = new HashMap<>();
        response.put("status", "received");
        return ResponseEntity.ok(response);
    }
    
    /**
     * GET /sms/health — Health check endpoint.
     */
    @GetMapping("/health")
    public ResponseEntity<?> health() {
        Map<String, String> response = new HashMap<>();
        response.put("status", "ok");
        return ResponseEntity.ok(response);
    }
}
```

Create the main Spring Boot application class:

```java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class TelnyxSmsApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(TelnyxSmsApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/two-way-sms-chat-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Spring Boot application after updating the environment variable. Check that `TelnyxOkHttpClient.fromEnv()` is being called in the configuration class. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. Verify the `TELNYX_PHONE_NUMBER` in your `.env` file is also in E.164 format. |
| Webhook Not Received | Your application does not receive webhook events from Telnyx even though the Messaging Profile is configured. | Ensure your webhook URL is publicly accessible. If testing locally, use ngrok: `ngrok http 8080` and update your Messaging Profile webhook URL to the ngrok URL (e.g., `https://abc123.ngrok.io/sms/webhook`). Verify the endpoint path is exactly `/sms/webhook` and the HTTP method is POST. Check your firewall and network settings to ensure inbound traffic is allowed. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx enforces rate limits on API calls. Implement exponential backoff in your application: wait 1 second, then 2 seconds, then 4 seconds between retries. For bulk SMS, use a queue (e.g., RabbitMQ, Kafka) to throttle message sending. Check your Telnyx account plan for rate limit details in the [Portal](https://portal.telnyx.com). |
| NullPointerException in SmsService | The application throws `NullPointerException` when calling `smsService.sendSms()`. | Ensure the `@Autowired` annotation is present on the `TelnyxClient` field in `SmsService`. Verify that `TelnyxConfig` is in a package that Spring scans (under `com.telnyx` or a subpackage). Check that the `@SpringBootApplication` annotation is on the main application class. Restart the Spring Boot application to ensure all beans are properly initialized. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Java version do I need?**

Java 17 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Send Bulk SMS Messages](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/otp-2fa).
- [Receive SMS Webhooks with Java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/receive-sms-webhook).
