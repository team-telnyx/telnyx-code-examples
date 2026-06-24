package com.telnyx.callforwarding;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import com.telnyx.TelnyxClient;
import com.telnyx.TelnyxOkHttpClient;
import com.telnyx.exception.APIConnectionException;
import com.telnyx.exception.APIException;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.model.CallControlResponse;
import lombok.Data;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.HashMap;
import java.util.Map;

@SpringBootApplication
public class CallForwardingApplication {
    public static void main(String[] args) {
        SpringApplication.run(CallForwardingApplication.class, args);
    }
}

@Data
@Component
@ConfigurationProperties(prefix = "telnyx")
class TelnyxProperties {
    private String apiKey;
    private String phoneNumber;
    private String connectionId;
}

@Service
class CallForwardingService {
    private final TelnyxClient client;
    private final TelnyxProperties telnyxProperties;
    
    public CallForwardingService(TelnyxProperties telnyxProperties) {
        this.telnyxProperties = telnyxProperties;
        this.client = TelnyxOkHttpClient.fromEnv();
    }
    
    public Map<String, String> initiateCall(String toNumber) throws APIException {
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                "Phone number must be in E.164 format (e.g., +15551234567)"
            );
        }
        
        try {
            CallControlResponse response = client.calls().dial(
                telnyxProperties.getPhoneNumber(),
                toNumber,
                telnyxProperties.getConnectionId()
            );
            
            Map<String, String> result = new HashMap<>();
            result.put("call_control_id", response.getData().getCallControlId());
            result.put("from", telnyxProperties.getPhoneNumber());
            result.put("to", toNumber);
            result.put("status", "initiated");
            
            return result;
        } catch (AuthenticationException e) {
            throw new AuthenticationException("Invalid Telnyx API key", e);
        } catch (RateLimitException e) {
            throw new RateLimitException("Rate limit exceeded", e);
        } catch (APIConnectionException e) {
            throw new APIConnectionException("Network error connecting to Telnyx", e);
        }
    }
    
    public Map<String, String> transferCall(String callControlId, String transferTo) 
            throws APIException {
        if (!transferTo.startsWith("+")) {
            throw new IllegalArgumentException(
                "Transfer number must be in E.164 format (e.g., +15551234567)"
            );
        }
        
        try {
            CallControlResponse response = client.calls().actions().transfer(
                callControlId,
                transferTo
            );
            
            Map<String, String> result = new HashMap<>();
            result.put("call_control_id", response.getData().getCallControlId());
            result.put("transfer_to", transferTo);
            result.put("status", "transfer_initiated");
            
            return result;
        } catch (AuthenticationException e) {
            throw new AuthenticationException("Invalid Telnyx API key", e);
        } catch (RateLimitException e) {
            throw new RateLimitException("Rate limit exceeded", e);
        } catch (APIConnectionException e) {
            throw new APIConnectionException("Network error connecting to Telnyx", e);
        }
    }
    
    public Map<String, String> hangupCall(String callControlId) throws APIException {
        try {
            CallControlResponse response = client.calls().actions().hangup(callControlId);
            
            Map<String, String> result = new HashMap<>();
            result.put("call_control_id", response.getData().getCallControlId());
            result.put("status", "hangup_initiated");
            
            return result;
        } catch (AuthenticationException e) {
            throw new AuthenticationException("Invalid Telnyx API key", e);
        } catch (RateLimitException e) {
            throw new RateLimitException("Rate limit exceeded", e);
        } catch (APIConnectionException e) {
            throw new APIConnectionException("Network error connecting to Telnyx", e);
        }
    }
}

@RestController
@RequestMapping("/api/calls")
class CallForwardingController {
    private final CallForwardingService callForwardingService;
    
    public CallForwardingController(CallForwardingService callForwardingService) {
        this.callForwardingService = callForwardingService;
    }
    
    @PostMapping("/initiate")
    public ResponseEntity<?> initiateCall(@RequestBody Map<String, String> request) {
        String toNumber = request.get("to");
        
        if (toNumber == null || toNumber.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'to'"));
        }
        
        try {
            Map<String, String> result = callForwardingService.initiateCall(toNumber);
            return ResponseEntity.ok(result);
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (RateLimitException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } catch (APIException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(Map.of("error", "Telnyx API error: " + e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }
    
    @PostMapping("/{callControlId}/transfer")
    public ResponseEntity<?> transferCall(
            @PathVariable String callControlId,
            @RequestBody Map<String, String> request) {
        String transferTo = request.get("transfer_to");
        
        if (transferTo == null || transferTo.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'transfer_to'"));
        }
        
        try {
            Map<String, String> result = callForwardingService.transferCall(
                callControlId, 
                transferTo
            );
            return ResponseEntity.ok(result);
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (RateLimitException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } catch (APIException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(Map.of("error", "Telnyx API error: " + e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }
    
    @PostMapping("/{callControlId}/hangup")
    public ResponseEntity<?> hangupCall(@PathVariable String callControlId) {
        try {
            Map<String, String> result = callForwardingService.hangupCall(callControlId);
            return ResponseEntity.ok(result);
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (RateLimitException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } catch (APIException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(Map.of("error", "Telnyx API error: " + e.getMessage()));
        }
    }
}

@RestController
@RequestMapping("/webhooks")
class WebhookController {
    private static final Logger logger = LoggerFactory.getLogger(WebhookController.class);
    
    @PostMapping("/call-events")
    public ResponseEntity<?> handleCallEvent(@RequestBody Map<String, Object> payload) {
        String eventType = (String) payload.get("data.event_type");
        String callControlId = (String) payload.get("data.call_control_id");
        
        logger.info("Received event: {} for call: {}", eventType, callControlId);
        
        if ("call.initiated".equals(eventType)) {
            logger.info("Call initiated: {}", callControlId);
        } else if ("call.answered".equals(eventType)) {
            logger.info("Call answered: {}", callControlId);
        } else if ("call.hangup".equals(eventType)) {
            logger.info("Call ended: {}", callControlId);
        } else if ("call.dtmf.received".equals(eventType)) {
            String digit = (String) payload.get("data.dtmf_digit");
            logger.info("DTMF digit received: {} for call: {}", digit, callControlId);
        }
        
        return ResponseEntity.ok(Map.of("status", "received"));
    }
}
