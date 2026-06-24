# MMS Send with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot endpoint that sends MMS messages with media attachments using the Telnyx Java SDK. This tutorial demonstrates the new client initialization pattern, proper error handling for telecom APIs, secure credential management via environment variables, and JSON serialization of SDK responses for HTTP endpoints.

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
- A Telnyx phone number enabled for outbound MMS.
- Spring Boot 2.7+ installed and configured.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-java
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a Spring configuration class to initialize the Telnyx client as a singleton bean:

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

Create a service class to handle MMS sending logic with proper validation:

```java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import com.telnyx.model.MessageCreateResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

@Service
public class MmsService {
    
    @Autowired
    private TelnyxClient telnyxClient;
    
    @Value("${telnyx.phone.number}")
    private String fromNumber;
    
    /**
     * Send MMS via Telnyx with media attachments.
     * Returns a JSON-serializable map of response data.
     */
    public Map<String, Object> sendMms(String toNumber, String message, String[] mediaUrls) 
            throws TelnyxException {
        
        // Validate E.164 format to prevent API errors
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                "Phone number must be in E.164 format (e.g., +15551234567)"
            );
        }
        
        if (mediaUrls == null || mediaUrls.length == 0) {
            throw new IllegalArgumentException(
                "At least one media URL is required for MMS"
            );
        }
        
        // Validate media URLs are accessible
        for (String url : mediaUrls) {
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                throw new IllegalArgumentException(
                    "Media URLs must be HTTP(S) accessible: " + url
                );
            }
        }
        
        // Create MMS message with media attachments
        MessageCreateResponse response = telnyxClient.messages().create(
            new HashMap<String, Object>() {{
                put("from_", fromNumber);
                put("to", toNumber);
                put("text", message);
                put("media_urls", Arrays.asList(mediaUrls));
            }}
        );
        
        // Extract serializable data — SDK objects are NOT JSON-serializable
        Map<String, Object> result = new HashMap<>();
        result.put("message_id", response.getData().getId());
        result.put("status", response.getData().getTo() != null && !response.getData().getTo().isEmpty() 
            ? response.getData().getTo().get(0).getStatus() 
            : "unknown");
        result.put("from", fromNumber);
        result.put("to", toNumber);
        result.put("media_count", mediaUrls.length);
        
        return result;
    }
}
```

Create a REST controller with comprehensive error handling:

```java
package com.telnyx.controller;

import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import com.telnyx.service.MmsService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/mms")
public class MmsController {
    
    @Autowired
    private MmsService mmsService;
    
    @PostMapping("/send")
    public ResponseEntity<Map<String, Object>> sendMms(@RequestBody MmsRequest request) {
        // Validate request payload
        if (request.getTo() == null || request.getTo().isEmpty()) {
            return ResponseEntity.badRequest().body(
                Map.of("error", "Missing required field: 'to'")
            );
        }
        
        if (request.getMessage() == null || request.getMessage().isEmpty()) {
            return ResponseEntity.badRequest().body(
                Map.of("error", "Missing required field: 'message'")
            );
        }
        
        if (request.getMediaUrls() == null || request.getMediaUrls().length == 0) {
            return ResponseEntity.badRequest().body(
                Map.of("error", "Missing required field: 'media_urls' (at least one URL required)")
            );
        }
        
        try {
            Map<String, Object> result = mmsService.sendMms(
                request.getTo(),
                request.getMessage(),
                request.getMediaUrls()
            );
            return ResponseEntity.ok(result);
            
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(
                Map.of("error", "Invalid API key")
            );
        } catch (RateLimitException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(
                Map.of("error", "Rate limit exceeded. Please slow down.")
            );
        } catch (TelnyxException e) {
            // Handle other Telnyx API errors
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(
                Map.of("error", e.getMessage())
            );
        } catch (IllegalArgumentException e) {
            // Handle validation errors
            return ResponseEntity.badRequest().body(
                Map.of("error", e.getMessage())
            );
        } catch (Exception e) {
            // Handle unexpected errors
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                Map.of("error", "Internal server error: " + e.getMessage())
            );
        }
    }
    
    /**
     * Global exception handler for uncaught Telnyx exceptions.
     */
    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<Map<String, Object>> handleAuthenticationException(AuthenticationException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(
            Map.of("error", "Authentication failed: " + e.getMessage())
        );
    }
    
    @ExceptionHandler(RateLimitException.class)
    public ResponseEntity<Map<String, Object>> handleRateLimitException(RateLimitException e) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(
            Map.of("error", "Rate limit exceeded")
        );
    }
    
    @ExceptionHandler(TelnyxException.class)
    public ResponseEntity<Map<String, Object>> handleTelnyxException(TelnyxException e) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(
            Map.of("error", "Telnyx API error: " + e.getMessage())
        );
    }
}
```

Create a request DTO class to handle incoming JSON:

```java
package com.telnyx.controller;

public class MmsRequest {
    private String to;
    private String message;
    private String[] mediaUrls;
    
    public String getTo() {
        return to;
    }
    
    public void setTo(String to) {
        this.to = to;
    }
    
    public String getMessage() {
        return message;
    }
    
    public void setMessage(String message) {
        this.message = message;
    }
    
    public String[] getMediaUrls() {
        return mediaUrls;
    }
    
    public void setMediaUrls(String[] mediaUrls) {
        this.mediaUrls = mediaUrls;
    }
}
```

Create the main Spring Boot application class:

```java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class MmsSenderApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(MmsSenderApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-mms-picture-message-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Spring Boot application after updating the environment variable. Check that `application.properties` correctly references `${TELNYX_API_KEY}`. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl request to use properly formatted numbers. Verify the `to` field in your JSON payload is a string, not a number. |
| Media URL Validation Fails | The endpoint returns `{"error": "Media URLs must be HTTP(S) accessible"}` even with valid URLs. | Confirm all media URLs in the `media_urls` array start with `http://` or `https://`. Ensure the URLs are publicly accessible and not behind authentication or firewalls. Test the URL in a browser to verify it returns the media file. The Telnyx API must be able to download the media from the provided URL. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Implement exponential backoff in your client code. Telnyx enforces rate limits per API key; space out requests by at least 100ms. If sending bulk MMS, consider using a message queue or batch processing service. Check your Telnyx account usage in the [Portal](https://portal.telnyx.com) to monitor API call volume. |
| Environment Variable Not Set | The application fails to start with `IllegalArgumentException` about missing `TELNYX_PHONE_NUMBER`. | Confirm environment variables are set before starting the application: `export TELNYX_API_KEY=...` and `export TELNYX_PHONE_NUMBER=...`. Verify `application.properties` uses the correct syntax: `${TELNYX_API_KEY}`. On Windows, use `set TELNYX_API_KEY=...` instead of `export`. Restart the terminal or IDE after setting environment variables. |

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

- [Send a Single SMS with Java and Spring](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/send-single-sms).
- [Receive SMS Webhooks with Java and Spring](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/receive-sms-webhook).
- [Implement Two-Factor Authentication with Java and Spring](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/otp-2fa).
