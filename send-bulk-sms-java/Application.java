package com.telnyx;

import com.telnyx.config.TelnyxProperties;
import com.telnyx.controller.SmsController;
import com.telnyx.model.Message;
import com.telnyx.rest.TelnyxClient;
import com.telnyx.rest.TelnyxOkHttpClient;
import com.telnyx.service.BulkSmsService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.concurrent.*;
import java.util.stream.Collectors;

@SpringBootApplication
public class BulkSmsSenderApplication {
    public static void main(String[] args) {
        SpringApplication.run(BulkSmsSenderApplication.class, args);
    }
}

// ============ Configuration ============
@Component
@ConfigurationProperties(prefix = "telnyx")
class TelnyxProperties {
    private String apiKey;
    private String phoneNumber;
    private RateLimit rateLimit = new RateLimit();

    public static class RateLimit {
        private int messagesPerSecond = 10;
        private int batchSize = 50;

        public int getMessagesPerSecond() {
            return messagesPerSecond;
        }

        public void setMessagesPerSecond(int messagesPerSecond) {
            this.messagesPerSecond = messagesPerSecond;
        }

        public int getBatchSize() {
            return batchSize;
        }

        public void setBatchSize(int batchSize) {
            this.batchSize = batchSize;
        }
    }

    public String getApiKey() {
        return apiKey;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
    }

    public String getPhoneNumber() {
        return phoneNumber;
    }

    public void setPhoneNumber(String phoneNumber) {
        this.phoneNumber = phoneNumber;
    }

    public RateLimit getRateLimit() {
        return rateLimit;
    }

    public void setRateLimit(RateLimit rateLimit) {
        this.rateLimit = rateLimit;
    }
}

// ============ Service ============
@Service
class BulkSmsService {
    private static final Logger logger = LoggerFactory.getLogger(BulkSmsService.class);
    private final TelnyxClient client;
    private final TelnyxProperties telnyxProperties;
    private final Semaphore rateLimiter;

    public BulkSmsService(TelnyxProperties telnyxProperties) {
        this.telnyxProperties = telnyxProperties;
        this.client = TelnyxOkHttpClient.fromEnv();
        this.rateLimiter = new Semaphore(telnyxProperties.getRateLimit().getMessagesPerSecond());
    }

    public Map<String, SmsResult> sendBulkSms(List<String> recipients, String messageText) {
        if (recipients == null || recipients.isEmpty()) {
            throw new IllegalArgumentException("Recipients list cannot be empty");
        }

        if (messageText == null || messageText.trim().isEmpty()) {
            throw new IllegalArgumentException("Message text cannot be empty");
        }

        List<String> validatedRecipients = recipients.stream()
                .peek(this::validatePhoneNumber)
                .collect(Collectors.toList());

        Map<String, SmsResult> results = new ConcurrentHashMap<>();
        ExecutorService executor = Executors.newFixedThreadPool(
                telnyxProperties.getRateLimit().getMessagesPerSecond()
        );

        try {
            List<CompletableFuture<Void>> futures = validatedRecipients.stream()
                    .map(recipient -> CompletableFuture.runAsync(
                            () -> sendSingleSms(recipient, messageText, results),
                            executor
                    ))
                    .collect(Collectors.toList());

            CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
        } finally {
            executor.shutdown();
        }

        return results;
    }

    private void sendSingleSms(String toNumber, String messageText, Map<String, SmsResult> results) {
        try {
            rateLimiter.acquire();

            Message response = client.messages.create(
                    new Message.CreateParams.Builder()
                            .setFrom(telnyxProperties.getPhoneNumber())
                            .setTo(toNumber)
                            .setText(messageText)
                            .build()
            );

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
            rateLimiter.release();
        }
    }

    private void validatePhoneNumber(String phoneNumber) {
        if (phoneNumber == null || !phoneNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                    "Phone number must be in E.164 format (e.g., +15551234567): " + phoneNumber
            );
        }
    }

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

// ============ Controller ============
@RestController
@RequestMapping("/api/sms")
class SmsController {
    private static final Logger logger = LoggerFactory.getLogger(SmsController.class);
    private final BulkSmsService bulkSmsService;

    public SmsController(BulkSmsService bulkSmsService) {
        this.bulkSmsService = bulkSmsService;
    }

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
