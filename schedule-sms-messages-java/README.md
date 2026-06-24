# Scheduled SMS with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that schedules SMS messages to be sent at specific times using the Telnyx Java SDK. This tutorial demonstrates how to integrate scheduled tasks with the Telnyx messaging API, manage credentials securely, and handle errors gracefully in a Spring environment.

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
cd telnyx-code-examples/schedule-sms-messages-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a model class to represent a scheduled SMS:

```java
package com.telnyx.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ScheduledSmsRequest {
    private String to;
    private String message;
    private LocalDateTime scheduledTime;
}
```

Create a service class to handle SMS scheduling and sending:

```java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.TelnyxException;
import com.telnyx.model.ScheduledSmsRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@Slf4j
public class SmsSchedulerService {

    @Autowired
    private TelnyxClient telnyxClient;

    @Value("${telnyx.phone.number}")
    private String fromNumber;

    // In-memory store for scheduled messages (use database in production)
    private final Map<String, ScheduledSmsRequest> scheduledMessages = new ConcurrentHashMap<>();

    /**
     * Schedule an SMS to be sent at a specific time.
     */
    public Map<String, Object> scheduleMessage(ScheduledSmsRequest request) {
        // Validate E.164 format
        if (!request.getTo().startsWith("+")) {
            throw new IllegalArgumentException(
                "Phone number must be in E.164 format (e.g., +15551234567)"
            );
        }

        // Validate scheduled time is in the future
        if (request.getScheduledTime().isBefore(LocalDateTime.now())) {
            throw new IllegalArgumentException(
                "Scheduled time must be in the future"
            );
        }

        // Generate unique ID for this scheduled message
        String messageId = "sched_" + System.currentTimeMillis();
        scheduledMessages.put(messageId, request);

        log.info("Message {} scheduled for {}", messageId, request.getScheduledTime());

        return Map.of(
            "message_id", messageId,
            "status", "scheduled",
            "scheduled_time", request.getScheduledTime().toString(),
            "to", request.getTo()
        );
    }

    /**
     * Check every minute for messages that should be sent.
     * This runs on a fixed schedule (every 60 seconds).
     */
    @Scheduled(fixedRate = 60000)
    public void processPendingMessages() {
        LocalDateTime now = LocalDateTime.now();
        List<String> messagesToRemove = new ArrayList<>();

        for (Map.Entry<String, ScheduledSmsRequest> entry : scheduledMessages.entrySet()) {
            String messageId = entry.getKey();
            ScheduledSmsRequest request = entry.getValue();

            // Check if it's time to send this message
            if (now.isAfter(request.getScheduledTime()) || now.equals(request.getScheduledTime())) {
                try {
                    sendSms(messageId, request);
                    messagesToRemove.add(messageId);
                } catch (Exception e) {
                    log.error("Failed to send scheduled message {}: {}", messageId, e.getMessage());
                    // Keep the message in the queue for retry
                }
            }
        }

        // Remove successfully sent messages
        messagesToRemove.forEach(scheduledMessages::remove);
    }

    /**
     * Send an SMS via Telnyx API.
     */
    private void sendSms(String messageId, ScheduledSmsRequest request) {
        try {
            // Call Telnyx API to send message
            var response = telnyxClient.messages().create(
                Map.of(
                    "from_", fromNumber,
                    "to", request.getTo(),
                    "text", request.getMessage()
                )
            );

            log.info(
                "Message {} sent successfully. Telnyx ID: {}",
                messageId,
                response.getData().getId()
            );
        } catch (TelnyxException e) {
            log.error("Telnyx API error sending message {}: {}", messageId, e.getMessage());
            throw new RuntimeException("Failed to send SMS: " + e.getMessage(), e);
        }
    }

    /**
     * Get all scheduled messages (for monitoring/debugging).
     */
    public List<Map<String, Object>> getScheduledMessages() {
        return scheduledMessages.entrySet().stream()
            .map(entry -> Map.of(
                "message_id", entry.getKey(),
                "to", entry.getValue().getTo(),
                "scheduled_time", entry.getValue().getScheduledTime().toString(),
                "message", entry.getValue().getMessage()
            ))
            .toList();
    }
}
```

Create a REST controller to expose the scheduling endpoint:

```java
package com.telnyx.controller;

import com.telnyx.model.ScheduledSmsRequest;
import com.telnyx.service.SmsSchedulerService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/sms")
@Slf4j
public class SmsController {

    @Autowired
    private SmsSchedulerService smsSchedulerService;

    /**
     * Schedule an SMS to be sent at a specific time.
     */
    @PostMapping("/schedule")
    public ResponseEntity<Map<String, Object>> scheduleSms(@RequestBody ScheduledSmsRequest request) {
        try {
            Map<String, Object> result = smsSchedulerService.scheduleMessage(request);
            return ResponseEntity.status(HttpStatus.CREATED).body(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Get all scheduled messages.
     */
    @GetMapping("/scheduled")
    public ResponseEntity<List<Map<String, Object>>> getScheduledMessages() {
        List<Map<String, Object>> messages = smsSchedulerService.getScheduledMessages();
        return ResponseEntity.ok(messages);
    }

    /**
     * Global exception handler for Telnyx API errors.
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleException(Exception e) {
        log.error("Unexpected error: {}", e.getMessage(), e);

        if (e.getMessage() != null && e.getMessage().contains("401")) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } else if (e.getMessage() != null && e.getMessage().contains("429")) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } else if (e.getMessage() != null && e.getMessage().contains("503")) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("error", "Network error connecting to Telnyx"));
        }

        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Map.of("error", "Internal server error: " + e.getMessage()));
    }
}
```

Create the main Spring Boot application class:

```java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ScheduledSmsApplication {
    public static void main(String[] args) {
        SpringApplication.run(ScheduledSmsApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/schedule-sms-messages-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The application fails to send messages with "Invalid API key" error. | Verify that `TELNYX_API_KEY` environment variable is set correctly before starting the application. Check the [Telnyx Portal](https://portal.telnyx.com) to confirm your API key is active and has not been regenerated. Ensure there are no trailing spaces or special characters in the key. Restart the Spring Boot application after updating the environment variable. |
| Invalid Phone Number Format | Requests return a 400 error stating "Phone number must be in E.164 format". | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces, dashes, or parentheses. Example: `+15551234567` (US) or `+447700900123` (UK). Update your curl request or client code to use properly formatted numbers. |
| Scheduled Messages Not Sending | Messages remain in the scheduled queue and are never sent even after the scheduled time passes. | Verify that the `@Scheduled` annotation is active by checking Spring Boot logs for "Scheduling enabled" message. Ensure `@EnableScheduling` is present in your `TelnyxConfig` class. Check that `TELNYX_PHONE_NUMBER` environment variable is set and valid. Review application logs for any exceptions during the `processPendingMessages()` execution. For production use, replace the in-memory `ConcurrentHashMap` with a persistent database. |
| Rate Limit Errors (429) | The application receives "Rate limit exceeded" responses from Telnyx API. | Implement exponential backoff retry logic in the `sendSms()` method. Reduce the frequency of scheduled message processing by increasing the `fixedRate` value in the `@Scheduled` annotation (e.g., from 60000ms to 120000ms). Batch multiple messages into a single API call where possible. Contact Telnyx support to request a higher rate limit for your account. |
| Environment Variable Not Loaded | The application throws `NullPointerException` when accessing `fromNumber` or fails to initialize the Telnyx client. | Confirm that environment variables are set before starting the application: `echo $TELNYX_API_KEY` and `echo $TELNYX_PHONE_NUMBER`. Verify that `application.properties` contains the correct property names: `telnyx.api.key` and `telnyx.phone.number`. If using an IDE, restart it after setting environment variables. For Maven, use `mvn spring-boot:run -Dspring-boot.run.arguments="--telnyx.api.key=YOUR_KEY"` as an alternative. |

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

- [Send a Single SMS with Java and Spring](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/send-single-sms).
- [Receive SMS Webhooks with Java and Spring](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/receive-sms-webhook).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/otp-2fa).
