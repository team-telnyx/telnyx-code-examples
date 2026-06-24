# Delivery Receipts with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that receives and processes SMS delivery receipts (webhooks) from Telnyx. This tutorial demonstrates how to configure a messaging profile with webhook endpoints, handle inbound delivery status updates, and store receipt data for audit trails. You'll learn the webhook event structure, proper request validation, and idiomatic Spring patterns for asynchronous message processing.

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
- A Telnyx phone number enabled for SMS.
- A publicly accessible URL (ngrok, Cloudflare Tunnel, or deployed server) to receive webhooks.
- Spring Boot 2.7+ or 3.0+.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-java
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create the delivery receipt entity to store webhook data:

```java
package com.telnyx.sms.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "delivery_receipts")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class DeliveryReceipt {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String messageId;

    @Column(nullable = false)
    private String direction;

    @Column(nullable = false)
    private String status;

    @Column(nullable = false)
    private String toNumber;

    @Column(nullable = false)
    private String fromNumber;

    @Column(length = 500)
    private String errorMessage;

    @Column(nullable = false)
    private LocalDateTime receivedAt;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
```

Create a repository to persist delivery receipts:

```java
package com.telnyx.sms.repository;

import com.telnyx.sms.model.DeliveryReceipt;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface DeliveryReceiptRepository extends JpaRepository<DeliveryReceipt, Long> {
    Optional<DeliveryReceipt> findByMessageId(String messageId);
}
```

Create a service to handle webhook processing:

```java
package com.telnyx.sms.service;

import com.telnyx.sms.model.DeliveryReceipt;
import com.telnyx.sms.repository.DeliveryReceiptRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Map;

@Service
@Slf4j
public class DeliveryReceiptService {
    private final DeliveryReceiptRepository repository;

    public DeliveryReceiptService(DeliveryReceiptRepository repository) {
        this.repository = repository;
    }

    /**
     * Process a webhook event from Telnyx and store the delivery receipt.
     * Expects a map with keys: message_id, direction, status, to, from, error_message, received_at.
     */
    public DeliveryReceipt processWebhookEvent(Map<String, Object> eventData) {
        String messageId = (String) eventData.get("message_id");
        String direction = (String) eventData.get("direction");
        String status = (String) eventData.get("status");
        String toNumber = (String) eventData.get("to");
        String fromNumber = (String) eventData.get("from");
        String errorMessage = (String) eventData.get("error_message");
        String receivedAtStr = (String) eventData.get("received_at");

        // Check if receipt already exists (idempotency)
        if (repository.findByMessageId(messageId).isPresent()) {
            log.warn("Duplicate webhook event for message_id: {}", messageId);
            return repository.findByMessageId(messageId).get();
        }

        DeliveryReceipt receipt = new DeliveryReceipt();
        receipt.setMessageId(messageId);
        receipt.setDirection(direction);
        receipt.setStatus(status);
        receipt.setToNumber(toNumber);
        receipt.setFromNumber(fromNumber);
        receipt.setErrorMessage(errorMessage);
        receipt.setReceivedAt(LocalDateTime.parse(receivedAtStr.replace("Z", "")));
        receipt.setCreatedAt(LocalDateTime.now());

        DeliveryReceipt saved = repository.save(receipt);
        log.info("Stored delivery receipt for message_id: {} with status: {}", messageId, status);

        return saved;
    }

    /**
     * Retrieve a delivery receipt by message ID.
     */
    public DeliveryReceipt getReceiptByMessageId(String messageId) {
        return repository.findByMessageId(messageId).orElse(null);
    }
}
```

Create a REST controller to handle webhook requests:

```java
package com.telnyx.sms.controller;

import com.telnyx.sms.model.DeliveryReceipt;
import com.telnyx.sms.service.DeliveryReceiptService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/webhooks")
@Slf4j
public class WebhookController {
    private final DeliveryReceiptService deliveryReceiptService;

    public WebhookController(DeliveryReceiptService deliveryReceiptService) {
        this.deliveryReceiptService = deliveryReceiptService;
    }

    /**
     * Webhook endpoint to receive SMS delivery status updates from Telnyx.
     * Telnyx sends POST requests with event data in the request body.
     */
    @PostMapping("/sms/delivery")
    public ResponseEntity<Map<String, Object>> handleDeliveryReceipt(
            @RequestBody Map<String, Object> payload) {
        
        try {
            log.info("Received webhook payload: {}", payload);

            // Extract the event data from the webhook payload
            Map<String, Object> eventData = (Map<String, Object>) payload.get("data");
            if (eventData == null) {
                log.error("Missing 'data' field in webhook payload");
                return ResponseEntity.badRequest()
                        .body(Map.of("error", "Missing 'data' field in payload"));
            }

            // Process the delivery receipt
            DeliveryReceipt receipt = deliveryReceiptService.processWebhookEvent(eventData);

            // Return acknowledgment to Telnyx (HTTP 200 indicates successful processing)
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "message_id", receipt.getMessageId(),
                    "status", receipt.getStatus()
            ));

        } catch (Exception e) {
            log.error("Error processing delivery receipt webhook", e);
            return ResponseEntity.status(500)
                    .body(Map.of("error", "Failed to process webhook: " + e.getMessage()));
        }
    }

    /**
     * Query endpoint to retrieve a stored delivery receipt by message ID.
     */
    @GetMapping("/sms/delivery/{messageId}")
    public ResponseEntity<Map<String, Object>> getDeliveryStatus(
            @PathVariable String messageId) {
        
        DeliveryReceipt receipt = deliveryReceiptService.getReceiptByMessageId(messageId);
        
        if (receipt == null) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(Map.of(
                "id", receipt.getId(),
                "message_id", receipt.getMessageId(),
                "direction", receipt.getDirection(),
                "status", receipt.getStatus(),
                "to", receipt.getToNumber(),
                "from", receipt.getFromNumber(),
                "error_message", receipt.getErrorMessage() != null ? receipt.getErrorMessage() : "",
                "received_at", receipt.getReceivedAt().toString(),
                "created_at", receipt.getCreatedAt().toString()
        ));
    }
}
```

Create the main Spring Boot application class:

```java
package com.telnyx.sms;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class SmsDeliveryReceiptsApplication {
    public static void main(String[] args) {
        SpringApplication.run(SmsDeliveryReceiptsApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-delivery-receipts-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not being received | The Spring Boot application is running, but Telnyx webhooks are not arriving at the endpoint. | Verify that your public URL (from ngrok or your deployed server) is correctly configured in the Telnyx Portal under Messaging Profiles. Ensure the webhook URL is exactly `https://your-domain.com/webhooks/sms/delivery`. Check that your firewall or network allows inbound POST requests on port 8080 (or your configured port). Use ngrok's web interface (`http://localhost:4040`) to inspect incoming requests. |
| Duplicate delivery receipts stored | The same message ID is being stored multiple times in the database. | The `processWebhookEvent()` method includes idempotency logic that checks for existing message IDs before inserting. If duplicates still occur, verify that the `messageId` column has a unique constraint in the database. Check the application logs for "Duplicate webhook event" warnings. Telnyx may retry failed webhook deliveries; ensure your endpoint returns HTTP 200 to acknowledge successful processing. |
| Null pointer exception when parsing webhook payload | The application crashes with `NullPointerException` when processing a webhook. | Verify that the webhook payload from Telnyx contains the expected `data` field with all required keys: `message_id`, `direction`, `status`, `to`, `from`, `received_at`. Log the raw payload to inspect its structure. Add null checks for optional fields like `error_message`. Ensure the `received_at` timestamp is in ISO 8601 format (e.g., `2026-06-24T14:30:00Z`). |
| H2 database not persisting data between restarts | Delivery receipts are lost when the Spring Boot application restarts. | The default H2 configuration uses an in-memory database (`jdbc:h2:mem:testdb`). For persistent storage, update `application.yml` to use a file-based database: `url: jdbc:h2:file:./data/deliverydb`. Create the `data` directory if it doesn't exist. For production, replace H2 with PostgreSQL or MySQL by updating the datasource configuration and adding the appropriate JDBC driver dependency. |

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

- [Send a Single SMS with Java and Spring](/tutorials/sms/java/send-single-sms).
- [Receive SMS Webhooks with Java and Spring](/tutorials/sms/java/receive-sms-webhook).
- [Send Bulk SMS Messages with Java and Spring](/tutorials/sms/java/send-bulk-sms).
