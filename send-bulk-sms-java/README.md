# Send Bulk SMS with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that sends bulk SMS messages using the Telnyx Java SDK. This tutorial demonstrates batch message processing with rate limiting, proper error handling for telecom APIs, and secure credential management via environment variables. You'll learn how to send hundreds of messages efficiently while respecting API rate limits and handling failures gracefully.

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
cd telnyx-code-examples/send-bulk-sms-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-java
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle bulk SMS sending with rate limiting:

```java
package com.telnyx.service;

import com.telnyx.config.TelnyxProperties;
import com.telnyx.model.Message;
import com.telnyx.rest.TelnyxClient;
import com.telnyx.rest.TelnyxOkHttpClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.*;
import java.util.stream.Collectors;

@Service
public class BulkSmsService {
    private static final Logger logger = LoggerFactory.getLogger(BulkSmsService.class);
    private final TelnyxClient client;
    private final TelnyxProperties telnyxProperties;
    private final Semaphore rateLimiter;

    public BulkSmsService(TelnyxProperties telnyxProperties) {
        this.telnyxProperties = telnyxProperties;
        this.client = TelnyxOkHttpClient.fromEnv();
        // Initialize semaphore based on configured rate limit.
        this.rateLimiter = new Semaphore(telnyxProperties.getRateLimit().getMessagesPerSecond());
    }

    /**
     * Send SMS to multiple recipients with rate limiting and error handling.
     * Returns a map of phone numbers to their send results.
     */
    public Map<String, SmsResult> sendBulkSms(List<String> recipients, String messageText) {
        if (recipients == null || recipients.isEmpty()) {
            throw new IllegalArgumentException("Recipients list cannot be empty");
        }

        if (messageText == null || messageText.trim().isEmpty()) {
            throw new IllegalArgumentException("Message text cannot be empty");
        }

        // Validate all phone numbers before sending.
        List<String> validatedRecipients = recipients.stream()
                .peek(this::validatePhoneNumber)
                .collect(Collectors.toList());

        Map<String, SmsResult> results = new ConcurrentHashMap<>();
        ExecutorService executor = Executors.newFixedThreadPool(
                telnyxProperties.getRateLimit().getMessagesPerSecond()
        );

        try {
            // Submit tasks for each recipient.
            List<CompletableFuture<Void>> futures = validatedRecipients.stream()
                    .map(recipient -> CompletableFuture.runAsync(
                            () -> sendSingleSms(recipient, messageText, results),
                            executor
                    ))
                    .collect(Collectors.toList());

            // Wait for all tasks to complete.
            CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
        } finally {
            executor.shutdown();
        }

        return results;
    }

    /**
     * Send a single SMS message with rate limiting.
     */
    private void sendSingleSms(String toNumber, String messageText, Map<String, SmsResult> results) {
        try {
            // Acquire permit from rate limiter (blocks if limit reached).
            rateLimiter.acquire();

            // Send the message via Telnyx API.
            Message response = client.messages.create(
                    new Message.CreateParams.Builder()
                            .setFrom(telnyxProperties.getPhoneNumber())
                            .setTo(toNumber)
                            .setText(messageText)
                            .build()
            );

            // Extract serializable result data.
            String status = response.getTo() != null && !response.getTo().isEmpty()
                    ? response.getTo().get(0).getStatus()
                    : "unknown";

            results.put(toNumber, new SmsResult(
                    response.getId(),
                    status,
                    null
            ));

            logger.info("SMS sent to {}: message_id={}", toNumber, response.getId());

        } catch (com.telnyx.exception.AuthenticationException e) {
            results.put(toNumber, new SmsResult(null, "failed", "Authentication error: " + e.getMessage()));
            logger.error("Authentication error for {}: {}", toNumber, e.getMessage());

        } catch (com.telnyx.exception.RateLimitException e) {
            results.put(toNumber, new SmsResult(null, "failed", "Rate limit exceeded"));
            logger.warn("Rate limit hit for {}", toNumber);

        } catch (com.telnyx.exception.ApiException e) {
            results.put(toNumber, new SmsResult(null, "failed", "API error: " + e.getMessage()));
            logger.error("API error for {}: {}", toNumber, e.getMessage());

        } catch (Exception e) {
            results.put(toNumber, new SmsResult(null, "failed", "Unexpected error: " + e.getMessage()));
            logger.error("Unexpected error for {}: {}", toNumber, e.getMessage());

        } finally {
            // Release the permit for the next message.
            rateLimiter.release();
        }
    }

    /**
     * Validate phone number format (E.164).
     */
    private void validatePhoneNumber(String phoneNumber) {
        if (phoneNumber == null || !phoneNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                    "Phone number must be in E.164 format (e.g., +15551234567): " + phoneNumber
            );
        }
    }

    /**
     * Data class to hold SMS send result.
     */
    public static class SmsResult {
        private final String messageId;
        private final String status;
        private final String error;

        public SmsResult(String messageId, String status, String error) {
            this.messageId = messageId;
            this.status = status;
            this.error = error;
        }

        public String getMessageId() {
            return messageId;
        }

        public String getStatus() {
            return status;
        }

        public String getError() {
            return error;
        }
    }
}
```

Create a REST controller to expose the bulk SMS endpoint:

```java
package com.telnyx.controller;

import com.telnyx.service.BulkSmsService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/sms")
public class SmsController {
    private static final Logger logger = LoggerFactory.getLogger(SmsController.class);
    private final BulkSmsService bulkSmsService;

    public SmsController(BulkSmsService bulkSmsService) {
        this.bulkSmsService = bulkSmsService;
    }

    /**
     * Endpoint to send bulk SMS messages.
     * POST /api/sms/send-bulk
     * Body: { "recipients": ["+15551234567", "+15559876543"], "message": "Hello!" }
     */
    @PostMapping("/send-bulk")
    public ResponseEntity<?> sendBulkSms(@RequestBody BulkSmsRequest request) {
        if (request.getRecipients() == null || request.getRecipients().isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Recipients list cannot be empty"));
        }

        if (request.getMessage() == null || request.getMessage().trim().isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Message text cannot be empty"));
        }

        try {
            Map<String, BulkSmsService.SmsResult> results = bulkSmsService.sendBulkSms(
                    request.getRecipients(),
                    request.getMessage()
            );

            // Convert results to serializable format.
            Map<String, Object> response = new LinkedHashMap<>();
            response.put("total", results.size());
            response.put("successful", results.values().stream()
                    .filter(r -> r.getError() == null)
                    .count());
            response.put("failed", results.values().stream()
                    .filter(r -> r.getError() != null)
                    .count());
            response.put("results", results.entrySet().stream()
                    .collect(LinkedHashMap::new,
                            (map, entry) -> map.put(entry.getKey(), Map.of(
                                    "message_id", entry.getValue().getMessageId(),
                                    "status", entry.getValue().getStatus(),
                                    "error", entry.getValue().getError()
                            )),
                            LinkedHashMap::putAll));

            return ResponseEntity.ok(response);

        } catch (IllegalArgumentException e) {
            logger.warn("Validation error: {}", e.getMessage());
            return ResponseEntity.badRequest()
                    .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Request body for bulk SMS endpoint.
     */
    public static class BulkSmsRequest {
        private List<String> recipients;
        private String message;

        public List<String> getRecipients() {
            return recipients;
        }

        public void setRecipients(List<String> recipients) {
            this.recipients = recipients;
        }

        public String getMessage() {
            return message;
        }

        public void setMessage(String message) {
            this.message = message;
        }
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-bulk-sms-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Authentication error: ..."}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Spring Boot application after updating the environment variable. Check that `TelnyxOkHttpClient.fromEnv()` is reading the correct key by adding debug logging. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers in the recipients list use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. Validate input before sending to the API. |
| Rate Limit Exceeded (429) | Some messages fail with "Rate limit exceeded" error in the results map. | The Semaphore-based rate limiter is working correctly but the configured `messagesPerSecond` may be too high for your API plan. Reduce `telnyx.rate-limit.messages-per-second` in `application.yml` from 10 to 5 or lower. Verify your Telnyx account's actual rate limit in the [Portal](https://portal.telnyx.com) and adjust the configuration accordingly. |
| Environment Variable Not Set | The application fails to start with "TELNYX_API_KEY not found" or similar error. | Ensure your `.env` file exists in the project root and contains `TELNYX_API_KEY=your_key_here`. For production, set environment variables in your deployment platform (Docker, Kubernetes, AWS Lambda, etc.) instead of using `.env`. Verify that Spring Boot is loading the environment variables correctly by checking application startup logs. |
| Concurrent Modification Exception | The application throws a `ConcurrentModificationException` when processing large batches. | The `ConcurrentHashMap` used in `results` is thread-safe, but ensure you are not iterating over it while other threads are modifying it. The current implementation avoids this by collecting results in a separate map and only iterating after all threads complete. If you modify the code, use `Collections.synchronizedMap()` or `ConcurrentHashMap` consistently. |

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
- [Implement Two-Factor Authentication with SMS](/tutorials/sms/java/otp-2fa).
- [Send Single SMS with Java](/tutorials/sms/java/send-single-sms).
