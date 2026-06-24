# SMS Notifications with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that sends SMS notifications using the Telnyx Java SDK. This tutorial demonstrates how to create a REST endpoint for sending notifications, implement proper error handling for telecom APIs, and manage credentials securely via environment variables. You'll learn to handle both single and batch notification scenarios with rate limiting and retry logic.

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
- A Telnyx phone number enabled for outbound SMS.
- Spring Boot 2.7+ or 3.0+.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-notifications-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle SMS sending logic with validation and error handling:

```java
package com.telnyx.service;

import com.telnyx.config.TelnyxConfig;
import com.telnyx.exception.TelnyxException;
import com.telnyx.model.Message;
import com.telnyx.net.TelnyxClient;
import com.telnyx.net.TelnyxOkHttpClient;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class SmsNotificationService {
    
    private final TelnyxConfig telnyxConfig;
    private final TelnyxClient client;
    
    public SmsNotificationService(TelnyxConfig telnyxConfig) {
        this.telnyxConfig = telnyxConfig;
        // Initialize Telnyx client using the SDK pattern
        this.client = TelnyxOkHttpClient.fromEnv();
    }
    
    /**
     * Send SMS notification to a single recipient.
     * Validates phone number format and returns serializable response data.
     */
    public Map<String, Object> sendNotification(String toNumber, String message) 
            throws TelnyxException {
        
        String fromNumber = telnyxConfig.getPhoneNumber();
        
        if (fromNumber == null || fromNumber.isEmpty()) {
            throw new IllegalArgumentException("TELNYX_PHONE_NUMBER not configured");
        }
        
        // Validate E.164 format to prevent API errors
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                "Phone number must be in E.164 format (e.g., +15551234567)"
            );
        }
        
        if (message == null || message.trim().isEmpty()) {
            throw new IllegalArgumentException("Message text cannot be empty");
        }
        
        try {
            // Create message using Telnyx SDK
            Message response = client.messages.create(
                new HashMap<String, Object>() {{
                    put("from", fromNumber);
                    put("to", toNumber);
                    put("text", message);
                }}
            );
            
            // Extract serializable data — SDK objects are NOT JSON-serializable
            Map<String, Object> result = new HashMap<>();
            result.put("message_id", response.getId());
            result.put("status", response.getTo() != null && !response.getTo().isEmpty() 
                ? response.getTo().get(0).getStatus() 
                : "unknown");
            result.put("from", fromNumber);
            result.put("to", toNumber);
            result.put("direction", response.getDirection());
            
            return result;
            
        } catch (TelnyxException e) {
            // Re-throw Telnyx exceptions for controller-level handling
            throw e;
        }
    }
}
```

Create a REST controller to expose the SMS notification endpoint:

```java
package com.telnyx.controller;

import com.telnyx.exception.TelnyxException;
import com.telnyx.service.SmsNotificationService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/sms")
public class SmsNotificationController {
    
    private final SmsNotificationService smsService;
    
    public SmsNotificationController(SmsNotificationService smsService) {
        this.smsService = smsService;
    }
    
    /**
     * POST /api/sms/send - Send a single SMS notification.
     * Request body: {"to": "+15559876543", "message": "Hello from Telnyx!"}
     */
    @PostMapping("/send")
    public ResponseEntity<Map<String, Object>> sendNotification(
            @RequestBody Map<String, String> request) {
        
        String toNumber = request.get("to");
        String message = request.get("message");
        
        // Validate request payload
        if (toNumber == null || toNumber.isEmpty()) {
            return ResponseEntity.badRequest().body(
                Map.of("error", "Missing required field: 'to'")
            );
        }
        
        if (message == null || message.isEmpty()) {
            return ResponseEntity.badRequest().body(
                Map.of("error", "Missing required field: 'message'")
            );
        }
        
        try {
            Map<String, Object> result = smsService.sendNotification(toNumber, message);
            return ResponseEntity.ok(result);
            
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(
                Map.of("error", e.getMessage())
            );
        } catch (TelnyxException e) {
            // Handle Telnyx-specific exceptions
            return handleTelnyxException(e);
        }
    }
    
    /**
     * Global exception handler for Telnyx API errors.
     * Maps SDK exceptions to appropriate HTTP status codes.
     */
    private ResponseEntity<Map<String, Object>> handleTelnyxException(TelnyxException e) {
        Map<String, Object> errorResponse = new HashMap<>();
        errorResponse.put("error", e.getMessage());
        
        // Check exception type and map to HTTP status
        if (e instanceof com.telnyx.exception.AuthenticationException) {
            errorResponse.put("error_type", "authentication_error");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(errorResponse);
        } else if (e instanceof com.telnyx.exception.RateLimitException) {
            errorResponse.put("error_type", "rate_limit_error");
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(errorResponse);
        } else if (e instanceof com.telnyx.exception.APIConnectionException) {
            errorResponse.put("error_type", "connection_error");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(errorResponse);
        } else if (e instanceof com.telnyx.exception.APIStatusException) {
            com.telnyx.exception.APIStatusException statusException = 
                (com.telnyx.exception.APIStatusException) e;
            errorResponse.put("status_code", statusException.getStatusCode());
            return ResponseEntity.status(statusException.getStatusCode()).body(errorResponse);
        }
        
        // Default to 500 for unknown Telnyx errors
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
    }
}
```

Create the main Spring Boot application class:

```java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class SmsNotificationsApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(SmsNotificationsApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-notifications-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key", "error_type": "authentication_error"}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes in your `.env` file. If the key was regenerated recently, update your environment file and restart the Spring Boot application with `mvn spring-boot:run`. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl test command to use properly formatted numbers. Verify the `to` field in your JSON request body is correctly formatted. |
| Environment Variable Not Set | The application fails to start with `IllegalArgumentException: TELNYX_PHONE_NUMBER not configured` or similar. | Confirm your `.env` file exists in the project root and contains both `TELNYX_API_KEY` and `TELNYX_PHONE_NUMBER` variables. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). When running with `mvn spring-boot:run`, Spring Boot should automatically load these variables. If using an IDE, configure environment variables in the run configuration. Restart the application after updating the `.env` file. |
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded", "error_type": "rate_limit_error"}` with HTTP 429. | You have exceeded the Telnyx API rate limit. Implement exponential backoff retry logic in your application or reduce the frequency of SMS requests. Check your [Telnyx Portal](https://portal.telnyx.com) for current rate limit settings. Consider batching notifications or using a message queue for high-volume scenarios. |
| Connection Error (503) | The endpoint returns `{"error": "Network error", "error_type": "connection_error"}` with HTTP 503. | Verify your internet connection and that the Telnyx API is accessible. Check if your firewall or proxy is blocking outbound HTTPS connections to `api.telnyx.com`. Ensure the Telnyx Java SDK is properly installed in your Maven dependencies. Try restarting the Spring Boot application. |

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
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/otp-2fa).
