// src/main/java/com/telnyx/InboundCallWebhookApplication.java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class InboundCallWebhookApplication {
    public static void main(String[] args) {
        SpringApplication.run(InboundCallWebhookApplication.class, args);
    }
}

// src/main/java/com/telnyx/controller/WebhookController.java
package com.telnyx.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/webhooks")
public class WebhookController {
    private static final Logger logger = LoggerFactory.getLogger(WebhookController.class);

    @PostMapping("/call")
    public ResponseEntity<Map<String, String>> handleCallWebhook(@RequestBody Map<String, Object> payload) {
        try {
            Map<String, Object> data = (Map<String, Object>) payload.get("data");
            String eventType = (String) payload.get("type");
            String callControlId = (String) data.get("call_control_id");
            String from = (String) data.get("from");
            String to = (String) data.get("to");

            logger.info("Received webhook event: {} for call: {}", eventType, callControlId);

            switch (eventType) {
                case "call.initiated":
                    handleCallInitiated(callControlId, from, to);
                    break;
                case "call.answered":
                    handleCallAnswered(callControlId);
                    break;
                case "call.hangup":
                    handleCallHangup(callControlId);
                    break;
                default:
                    logger.warn("Unknown event type: {}", eventType);
            }

            return ResponseEntity.ok(Map.of("status", "received"));

        } catch (Exception e) {
            logger.error("Error processing webhook", e);
            return ResponseEntity.status(500).body(Map.of("error", "Internal server error"));
        }
    }

    private void handleCallInitiated(String callControlId, String from, String to) {
        logger.info("Call initiated: {} from {} to {}", callControlId, from, to);
    }

    private void handleCallAnswered(String callControlId) {
        logger.info("Call answered: {}", callControlId);
    }

    private void handleCallHangup(String callControlId) {
        logger.info("Call hangup: {}", callControlId);
    }
}

// src/main/java/com/telnyx/service/CallService.java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.TelnyxOkHttpClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class CallService {
    private static final Logger logger = LoggerFactory.getLogger(CallService.class);
    private final TelnyxClient client;

    public CallService() {
        this.client = TelnyxOkHttpClient.fromEnv();
    }

    public Map<String, Object> getCallStatus(String callControlId) {
        try {
            var response = client.calls().retrieveStatus(callControlId);
            var callData = response.getData();

            return Map.of(
                "call_control_id", callData.getCallControlId(),
                "is_alive", callData.getIsAlive(),
                "state", callData.getState() != null ? callData.getState().toString() : "unknown"
            );
        } catch (Exception e) {
            logger.error("Error retrieving call status for {}: {}", callControlId, e.getMessage());
            throw new RuntimeException("Failed to retrieve call status", e);
        }
    }

    public void answerCall(String callControlId) {
        try {
            client.calls().actions().answer(callControlId);
            logger.info("Answered call: {}", callControlId);
        } catch (Exception e) {
            logger.error("Error answering call {}: {}", callControlId, e.getMessage());
            throw new RuntimeException("Failed to answer call", e);
        }
    }

    public void hangupCall(String callControlId) {
        try {
            client.calls().actions().hangup(callControlId);
            logger.info("Hung up call: {}", callControlId);
        } catch (Exception e) {
            logger.error("Error hanging up call {}: {}", callControlId, e.getMessage());
            throw new RuntimeException("Failed to hangup call", e);
        }
    }
}

// src/main/java/com/telnyx/exception/GlobalExceptionHandler.java
package com.telnyx.exception;

import com.telnyx.exception.api.ApiException;
import com.telnyx.exception.api.AuthenticationException;
import com.telnyx.exception.api.RateLimitException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

import java.util.Map;

@ControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger logger = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<Map<String, String>> handleAuthenticationError(AuthenticationException e) {
        logger.error("Authentication error: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
            .body(Map.of("error", "Invalid API key"));
    }

    @ExceptionHandler(RateLimitException.class)
    public ResponseEntity<Map<String, String>> handleRateLimitError(RateLimitException e) {
        logger.error("Rate limit exceeded: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
            .body(Map.of("error", "Rate limit exceeded. Please slow down."));
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, String>> handleApiError(ApiException e) {
        logger.error("API error: {}", e.getMessage());
        int statusCode = e.getStatusCode() != null ? e.getStatusCode() : 500;
        return ResponseEntity.status(statusCode)
            .body(Map.of("error", e.getMessage(), "status_code", String.valueOf(statusCode)));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleGenericError(Exception e) {
        logger.error("Unexpected error", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Map.of("error", "Internal server error"));
    }
}
