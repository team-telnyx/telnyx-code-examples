# SMS Autoresponder with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that automatically responds to incoming SMS messages using the Telnyx Java SDK. This tutorial demonstrates webhook handling for inbound messages, proper error handling for telecom APIs, and secure credential management via environment variables. You'll configure a Messaging Profile with a webhook URL, process inbound SMS events, and send automatic replies.

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
- Maven 3.6 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for inbound SMS.
- A publicly accessible URL for webhook delivery (ngrok, Cloudflare Tunnel, or deployed server).
- curl or Postman for testing.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-auto-reply-bot-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-auto-reply-bot-java
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle SMS operations:

```java
package com.telnyx.sms;

import com.telnyx.sdk.TelnyxClient;
import com.telnyx.sdk.TelnyxOkHttpClient;
import com.telnyx.sdk.exception.AuthenticationException;
import com.telnyx.sdk.exception.RateLimitException;
import com.telnyx.sdk.exception.TelnyxException;
import com.telnyx.sdk.model.Message;
import com.telnyx.sdk.model.MessageCreateRequest;
import com.telnyx.sdk.model.MessageResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class SmsService {
    
    private static final Logger logger = LoggerFactory.getLogger(SmsService.class);
    private final TelnyxClient client;
    private final TelnyxConfig config;
    
    public SmsService(TelnyxConfig config) {
        this.config = config;
        // Initialize Telnyx client from environment variable
        this.client = TelnyxOkHttpClient.fromEnv();
    }
    
    /**
     * Send an SMS message via Telnyx.
     * 
     * @param toNumber Recipient phone number in E.164 format.
     * @param message Text content of the message.
     * @return Map containing message ID and status.
     * @throws IllegalArgumentException if phone number format is invalid.
     * @throws TelnyxException if API call fails.
     */
    public Message sendSms(String toNumber, String message) throws TelnyxException {
        String fromNumber = config.getPhoneNumber();
        
        if (fromNumber == null || fromNumber.isEmpty()) {
            throw new IllegalArgumentException("TELNYX_PHONE_NUMBER environment variable not set");
        }
        
        // Validate E.164 format to prevent API errors
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                "Phone number must be in E.164 format (e.g., +15551234567)"
            );
        }
        
        logger.info("Sending SMS from {} to {}", fromNumber, toNumber);
        
        // Create message request
        MessageCreateRequest request = new MessageCreateRequest();
        request.setFrom(fromNumber);
        request.setTo(toNumber);
        request.setText(message);
        
        // Send via Telnyx API
        MessageResponse response = client.messages().create(request);
        
        logger.info("Message sent with ID: {}", response.getData().getId());
        return response.getData();
    }
}
```

Create a controller to handle webhook events and send autoresponses:

```java
package com.telnyx.sms;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.telnyx.sdk.exception.TelnyxException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/webhooks")
public class WebhookController {
    
    private static final Logger logger = LoggerFactory.getLogger(WebhookController.class);
    private final SmsService smsService;
    
    public WebhookController(SmsService smsService) {
        this.smsService = smsService;
    }
    
    /**
     * Webhook endpoint to receive inbound SMS events from Telnyx.
     * Automatically sends a reply to incoming messages.
     */
    @PostMapping("/sms")
    public ResponseEntity<Map<String, Object>> handleSmsWebhook(@RequestBody String payload) {
        try {
            logger.info("Received webhook payload: {}", payload);
            
            // Parse JSON payload
            JsonObject json = JsonParser.parseString(payload).getAsJsonObject();
            
            // Extract event data
            if (!json.has("data")) {
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "Invalid webhook payload: missing 'data' field"));
            }
            
            JsonObject data = json.getAsJsonObject("data");
            String eventType = data.has("event_type") ? data.get("event_type").getAsString() : "";
            
            // Only process inbound messages
            if (!"message.received".equals(eventType)) {
                logger.debug("Ignoring event type: {}", eventType);
                return ResponseEntity.ok(Map.of("status", "ignored"));
            }
            
            // Extract message details
            String fromNumber = data.has("from") ? data.get("from").getAsString() : null;
            String messageText = data.has("text") ? data.get("text").getAsString() : null;
            
            if (fromNumber == null || messageText == null) {
                logger.warn("Missing required fields in webhook payload");
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing 'from' or 'text' field"));
            }
            
            logger.info("Inbound SMS from {} with text: {}", fromNumber, messageText);
            
            // Generate autoresponse message
            String autoresponse = generateAutoresponse(messageText);
            
            // Send autoresponse
            smsService.sendSms(fromNumber, autoresponse);
            
            return ResponseEntity.ok(Map.of(
                "status", "success",
                "message", "Autoresponse sent",
                "from", fromNumber
            ));
            
        } catch (TelnyxException e) {
            logger.error("Telnyx API error: {}", e.getMessage(), e);
            return handleTelnyxException(e);
        } catch (Exception e) {
            logger.error("Unexpected error processing webhook: {}", e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Internal server error: " + e.getMessage()));
        }
    }
    
    /**
     * Generate an autoresponse based on the inbound message.
     * In production, this could integrate with NLP or a rules engine.
     */
    private String generateAutoresponse(String inboundMessage) {
        String lower = inboundMessage.toLowerCase();
        
        if (lower.contains("hello") || lower.contains("hi")) {
            return "Hello! Thanks for reaching out. We'll get back to you shortly.";
        } else if (lower.contains("help")) {
            return "We're here to help! Please describe your issue and we'll assist you.";
        } else if (lower.contains("hours")) {
            return "Our business hours are Monday-Friday, 9 AM - 5 PM EST.";
        } else {
            return "Thank you for your message. We've received it and will respond soon.";
        }
    }
    
    /**
     * Map Telnyx exceptions to appropriate HTTP status codes.
     */
    private ResponseEntity<Map<String, Object>> handleTelnyxException(TelnyxException e) {
        Map<String, Object> errorResponse = new HashMap<>();
        errorResponse.put("error", e.getMessage());
        
        if (e instanceof com.telnyx.sdk.exception.AuthenticationException) {
            errorResponse.put("code", "AUTHENTICATION_ERROR");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(errorResponse);
        } else if (e instanceof com.telnyx.sdk.exception.RateLimitException) {
            errorResponse.put("code", "RATE_LIMIT_EXCEEDED");
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(errorResponse);
        } else {
            errorResponse.put("code", "API_ERROR");
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(errorResponse);
        }
    }
}
```

Create the main Spring Boot application class:

```java
package com.telnyx.sms;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class SmsAutoresponderApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(SmsAutoresponderApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-auto-reply-bot-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving events | The application is running but Telnyx is not sending webhook payloads to your endpoint. | Verify that your Messaging Profile webhook URL in the [Telnyx Portal](https://portal.telnyx.com) is set to your public URL (e.g., `https://abc123.ngrok.io/webhooks/sms`). Ensure the URL is publicly accessible by testing it with curl from another terminal. Check application logs for incoming requests. If using ngrok, note that the tunnel URL changes on restart—update the Messaging Profile webhook URL accordingly. |
| Authentication Error (401) | The application logs show `AuthenticationException` when attempting to send SMS. | Verify that the `TELNYX_API_KEY` environment variable is set correctly. Run `echo $TELNYX_API_KEY` to confirm the value. Ensure there are no trailing spaces or quotes. If the key was regenerated in the Telnyx Portal, update your environment and restart the Spring Boot application with `mvn spring-boot:run`. |
| Invalid Phone Number Format | The autoresponder fails with "Phone number must be in E.164 format" error. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Verify the `TELNYX_PHONE_NUMBER` environment variable is set correctly in E.164 format. |
| Webhook payload parsing fails | The application logs show JSON parsing errors when processing webhook events. | Verify that the webhook payload is valid JSON. Check that the `data` field exists in the payload. Ensure the `event_type` field is present and set to `message.received` for inbound SMS events. Test with the curl command provided in Step 4 to confirm the endpoint accepts valid payloads. |
| Rate limit errors (429) | The application returns HTTP 429 with "RATE_LIMIT_EXCEEDED" message. | Telnyx enforces rate limits on API calls. Implement exponential backoff retry logic in production. Space out SMS sends to avoid hitting limits. Check your Telnyx account plan for rate limit details in the [Portal](https://portal.telnyx.com). Consider using a message queue (e.g., RabbitMQ) to throttle outbound messages. |

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

- [Receive SMS Webhooks with Java](/tutorials/sms/java/receive-sms-webhook).
- [Send Bulk SMS Messages with Java](/tutorials/sms/java/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/java/otp-2fa).
