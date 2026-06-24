# MMS Receive with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that receives inbound MMS messages via Telnyx webhooks. This tutorial demonstrates webhook configuration, payload validation, secure credential management, and proper error handling for telecom APIs. You'll learn how to parse incoming MMS events, extract media URLs, and persist message data for downstream processing.

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
- Maven 3.6+ or Gradle 7.0+.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for inbound MMS.
- A publicly accessible URL (ngrok, Cloudflare Tunnel, or deployed server) to receive webhooks.
- curl or Postman for testing.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-mms-webhook-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create the Spring Boot application class at `src/main/java/com/telnyx/MmsReceiverApplication.java`:

```java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class MmsReceiverApplication {
    public static void main(String[] args) {
        SpringApplication.run(MmsReceiverApplication.class, args);
    }
}
```

Create a configuration class at `src/main/java/com/telnyx/config/TelnyxConfig.java` to initialize the Telnyx client:

```java
package com.telnyx.config;

import com.telnyx.TelnyxClient;
import com.telnyx.TelnyxOkHttpClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TelnyxConfig {
    
    @Value("${telnyx.api.key}")
    private String apiKey;
    
    @Bean
    public TelnyxClient telnyxClient() {
        // Initialize using environment variable pattern
        return TelnyxOkHttpClient.fromEnv();
    }
}
```

Create a model class at `src/main/java/com/telnyx/model/MmsMessage.java` to represent incoming MMS data:

```java
package com.telnyx.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.Map;

public class MmsMessage {
    
    @JsonProperty("data")
    private MessageData data;
    
    @JsonProperty("meta")
    private Map<String, Object> meta;
    
    public static class MessageData {
        @JsonProperty("id")
        private String id;
        
        @JsonProperty("type")
        private String type;
        
        @JsonProperty("direction")
        private String direction;
        
        @JsonProperty("from")
        private PhoneNumber from;
        
        @JsonProperty("to")
        private List<PhoneNumber> to;
        
        @JsonProperty("text")
        private String text;
        
        @JsonProperty("media")
        private List<MediaItem> media;
        
        @JsonProperty("received_at")
        private String receivedAt;
        
        // Getters
        public String getId() { return id; }
        public String getType() { return type; }
        public String getDirection() { return direction; }
        public PhoneNumber getFrom() { return from; }
        public List<PhoneNumber> getTo() { return to; }
        public String getText() { return text; }
        public List<MediaItem> getMedia() { return media; }
        public String getReceivedAt() { return receivedAt; }
    }
    
    public static class PhoneNumber {
        @JsonProperty("phone_number")
        private String phoneNumber;
        
        public String getPhoneNumber() { return phoneNumber; }
    }
    
    public static class MediaItem {
        @JsonProperty("url")
        private String url;
        
        @JsonProperty("content_type")
        private String contentType;
        
        @JsonProperty("size")
        private Long size;
        
        public String getUrl() { return url; }
        public String getContentType() { return contentType; }
        public Long getSize() { return size; }
    }
    
    public MessageData getData() { return data; }
    public Map<String, Object> getMeta() { return meta; }
}
```

Create a service class at `src/main/java/com/telnyx/service/MmsService.java` to handle MMS processing:

```java
package com.telnyx.service;

import com.telnyx.model.MmsMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import java.util.HashMap;
import java.util.Map;

@Service
public class MmsService {
    
    private static final Logger logger = LoggerFactory.getLogger(MmsService.class);
    
    /**
     * Process incoming MMS message and extract relevant data.
     * In production, this would persist to a database or trigger downstream workflows.
     */
    public Map<String, Object> processMmsMessage(MmsMessage mmsMessage) {
        MmsMessage.MessageData data = mmsMessage.getData();
        
        // Validate required fields
        if (data == null || data.getId() == null) {
            throw new IllegalArgumentException("Invalid MMS payload: missing message data or ID");
        }
        
        // Log the incoming message
        logger.info("Received MMS message: id={}, from={}, direction={}", 
            data.getId(),
            data.getFrom() != null ? data.getFrom().getPhoneNumber() : "unknown",
            data.getDirection()
        );
        
        // Extract media information
        Map<String, Object> mediaInfo = new HashMap<>();
        if (data.getMedia() != null && !data.getMedia().isEmpty()) {
            data.getMedia().forEach(media -> {
                logger.info("Media attachment: url={}, type={}, size={}", 
                    media.getUrl(), 
                    media.getContentType(), 
                    media.getSize()
                );
            });
            mediaInfo.put("count", data.getMedia().size());
            mediaInfo.put("attachments", data.getMedia().stream()
                .map(m -> Map.of(
                    "url", m.getUrl(),
                    "content_type", m.getContentType(),
                    "size", m.getSize()
                ))
                .toList()
            );
        }
        
        // Build response object
        Map<String, Object> result = new HashMap<>();
        result.put("message_id", data.getId());
        result.put("from", data.getFrom() != null ? data.getFrom().getPhoneNumber() : null);
        result.put("to", data.getTo() != null ? 
            data.getTo().stream().map(MmsMessage.PhoneNumber::getPhoneNumber).toList() : null);
        result.put("text", data.getText());
        result.put("direction", data.getDirection());
        result.put("received_at", data.getReceivedAt());
        result.put("media", mediaInfo);
        
        return result;
    }
}
```

Create the webhook controller at `src/main/java/com/telnyx/controller/WebhookController.java`:

```java
package com.telnyx.controller;

import com.telnyx.model.MmsMessage;
import com.telnyx.service.MmsService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/webhooks")
public class WebhookController {
    
    private static final Logger logger = LoggerFactory.getLogger(WebhookController.class);
    
    @Autowired
    private MmsService mmsService;
    
    /**
     * Webhook endpoint to receive inbound MMS messages from Telnyx.
     * Configure this URL in the Telnyx Portal under Messaging Profiles.
     */
    @PostMapping("/message")
    public ResponseEntity<Map<String, Object>> handleMmsWebhook(@RequestBody MmsMessage mmsMessage) {
        try {
            // Validate webhook payload
            if (mmsMessage == null || mmsMessage.getData() == null) {
                logger.warn("Received invalid webhook payload");
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "Invalid webhook payload"));
            }
            
            // Check if this is an inbound message
            String direction = mmsMessage.getData().getDirection();
            if (!"inbound".equals(direction)) {
                logger.debug("Ignoring non-inbound message: direction={}", direction);
                return ResponseEntity.ok(Map.of("status", "ignored"));
            }
            
            // Process the MMS message
            Map<String, Object> processedMessage = mmsService.processMmsMessage(mmsMessage);
            
            logger.info("Successfully processed MMS message: {}", processedMessage.get("message_id"));
            
            // Return 200 OK to acknowledge receipt (Telnyx expects this)
            Map<String, Object> response = new HashMap<>();
            response.put("status", "received");
            response.put("message", processedMessage);
            
            return ResponseEntity.ok(response);
            
        } catch (IllegalArgumentException e) {
            logger.error("Validation error: {}", e.getMessage());
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("Unexpected error processing webhook", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Internal server error"));
        }
    }
    
    /**
     * Health check endpoint for monitoring.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        return ResponseEntity.ok(Map.of("status", "healthy"));
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-mms-webhook-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving messages | The Spring Boot application is running, but Telnyx is not sending webhook events to your endpoint. | Verify the webhook URL is correctly configured in the Telnyx Portal under Messaging Profiles. Ensure the URL is publicly accessible (use ngrok for local testing). Check that your firewall or network allows inbound HTTPS traffic on port 8080. Verify the Messaging Profile is associated with the phone number receiving the MMS. |
| Invalid webhook payload error | The endpoint returns `{"error": "Invalid webhook payload"}` when a message is received. | Ensure the incoming JSON structure matches the `MmsMessage` model class. Check the Telnyx webhook documentation to confirm the payload format. Enable DEBUG logging (`logging.level.com.telnyx=DEBUG`) to see the raw payload being received. Verify that Jackson is correctly deserializing the JSON by checking for `@JsonProperty` annotations on all fields. |
| Media attachments not appearing | The MMS message is received but the `media` field in the response is empty or shows `count: 0`. | Confirm that the MMS message actually contains media attachments when sent. Check the Telnyx Portal message logs to verify media was included in the inbound message. Ensure the `media` field in the `MmsMessage.MessageData` class is properly annotated with `@JsonProperty("media")`. Verify that the media URLs are valid and accessible by testing them in a browser. |
| Spring Boot fails to start with "TELNYX_API_KEY not set" | The application throws an error during startup because the environment variable is missing. | Set the `TELNYX_API_KEY` environment variable before starting the application: `export TELNYX_API_KEY=your_key_here` (Linux/Mac) or `set TELNYX_API_KEY=your_key_here` (Windows). Alternatively, create a `.env` file in the project root and use a tool like `dotenv-maven-plugin` to load it. Verify the API key is valid by testing it in the Telnyx Portal. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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

- [Receive SMS Webhooks with Java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/receive-sms-webhook).
- [Send Bulk SMS Messages with Java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/send-bulk-sms).
- [Implement Two-Factor Authentication with Java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/otp-2fa).
