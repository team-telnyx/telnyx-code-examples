// pom.xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.telnyx</groupId>
    <artifactId>sms-delivery-receipts</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.1.5</version>
        <relativePath/>
    </parent>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>com.telnyx</groupId>
            <artifactId>telnyx-java</artifactId>
            <version>2.0.0</version>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        <dependency>
            <groupId>com.h2database</groupId>
            <artifactId>h2</artifactId>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
        </plugins>
    </build>
</project>

// src/main/resources/application.yml
spring:
  application:
    name: sms-delivery-receipts
  datasource:
    url: jdbc:h2:mem:testdb
    driverClassName: org.h2.Driver
  jpa:
    database-platform: org.hibernate.dialect.H2Dialect
    hibernate:
      ddl-auto: create-drop
  h2:
    console:
      enabled: true

server:
  port: 8080

telnyx:
  api-key: ${TELNYX_API_KEY}
  webhook-secret: ${TELNYX_WEBHOOK_SECRET:}

// src/main/java/com/telnyx/sms/SmsDeliveryReceiptsApplication.java
package com.telnyx.sms;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class SmsDeliveryReceiptsApplication {
    public static void main(String[] args) {
        SpringApplication.run(SmsDeliveryReceiptsApplication.class, args);
    }
}

// src/main/java/com/telnyx/sms/model/DeliveryReceipt.java
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

// src/main/java/com/telnyx/sms/repository/DeliveryReceiptRepository.java
package com.telnyx.sms.repository;

import com.telnyx.sms.model.DeliveryReceipt;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface DeliveryReceiptRepository extends JpaRepository<DeliveryReceipt, Long> {
    Optional<DeliveryReceipt> findByMessageId(String messageId);
}

// src/main/java/com/telnyx/sms/service/DeliveryReceiptService.java
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

// src/main/java/com/telnyx/sms/controller/WebhookController.java
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
