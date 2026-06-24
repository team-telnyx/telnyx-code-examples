// src/main/java/com/telnyx/TtsVoiceApplication.java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class TtsVoiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(TtsVoiceApplication.class, args);
    }
}

// src/main/java/com/telnyx/config/TelnyxConfig.java
package com.telnyx.config;

import com.telnyx.sdk.TelnyxClient;
import com.telnyx.sdk.TelnyxOkHttpClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TelnyxConfig {
    
    @Value("${telnyx.api.key}")
    private String apiKey;
    
    @Value("${telnyx.phone.number}")
    private String phoneNumber;
    
    @Value("${telnyx.connection.id}")
    private String connectionId;
    
    @Bean
    public TelnyxClient telnyxClient() {
        return TelnyxOkHttpClient.fromEnv();
    }
    
    @Bean
    public TelnyxProperties telnyxProperties() {
        return new TelnyxProperties(apiKey, phoneNumber, connectionId);
    }
}

// src/main/java/com/telnyx/config/TelnyxProperties.java
package com.telnyx.config;

public class TelnyxProperties {
    private final String apiKey;
    private final String phoneNumber;
    private final String connectionId;
    
    public TelnyxProperties(String apiKey, String phoneNumber, String connectionId) {
        this.apiKey = apiKey;
        this.phoneNumber = phoneNumber;
        this.connectionId = connectionId;
    }
    
    public String getApiKey() {
        return apiKey;
    }
    
    public String getPhoneNumber() {
        return phoneNumber;
    }
    
    public String getConnectionId() {
        return connectionId;
    }
}

// src/main/java/com/telnyx/service/VoiceService.java
package com.telnyx.service;

import com.telnyx.sdk.TelnyxClient;
import com.telnyx.sdk.exception.ApiException;
import com.telnyx.sdk.model.CallControlCommandResponse;
import com.telnyx.sdk.model.CallDialRequest;
import com.telnyx.sdk.model.CallSpeakRequest;
import com.telnyx.config.TelnyxProperties;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class VoiceService {
    
    private final TelnyxClient telnyxClient;
    private final TelnyxProperties telnyxProperties;
    
    public VoiceService(TelnyxClient telnyxClient, TelnyxProperties telnyxProperties) {
        this.telnyxClient = telnyxClient;
        this.telnyxProperties = telnyxProperties;
    }
    
    public Map<String, Object> initiateCall(String toNumber) throws ApiException {
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException("Phone number must be in E.164 format (e.g., +15551234567)");
        }
        
        CallDialRequest request = new CallDialRequest();
        request.setFrom(telnyxProperties.getPhoneNumber());
        request.setTo(toNumber);
        request.setConnectionId(telnyxProperties.getConnectionId());
        
        CallControlCommandResponse response = telnyxClient.calls().dial(request);
        
        Map<String, Object> result = new HashMap<>();
        result.put("call_control_id", response.getData().getCallControlId());
        result.put("from", telnyxProperties.getPhoneNumber());
        result.put("to", toNumber);
        result.put("status", "initiated");
        
        return result;
    }
    
    public Map<String, Object> playTts(String callControlId, String message) throws ApiException {
        if (message == null || message.trim().isEmpty()) {
            throw new IllegalArgumentException("Message cannot be empty");
        }
        
        CallSpeakRequest request = new CallSpeakRequest();
        request.setPayload(message);
        request.setLanguage("en-US");
        request.setVoice("female");
        
        CallControlCommandResponse response = telnyxClient.calls().actions().speak(callControlId, request);
        
        Map<String, Object> result = new HashMap<>();
        result.put("call_control_id", response.getData().getCallControlId());
        result.put("message", message);
        result.put("status", "speaking");
        
        return result;
    }
}

// src/main/java/com/telnyx/controller/VoiceController.java
package com.telnyx.controller;

import com.telnyx.service.VoiceService;
import com.telnyx.sdk.exception.ApiException;
import com.telnyx.sdk.exception.ApiConnectionException;
import com.telnyx.sdk.exception.AuthenticationException;
import com.telnyx.sdk.exception.RateLimitException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/voice")
public class VoiceController {
    
    private final VoiceService voiceService;
    
    public VoiceController(VoiceService voiceService) {
        this.voiceService = voiceService;
    }
    
    @PostMapping("/call")
    public ResponseEntity<?> initiateCall(@RequestBody Map<String, String> request) {
        String toNumber = request.get("to");
        String message = request.get("message");
        
        if (toNumber == null || toNumber.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'to'"));
        }
        
        if (message == null || message.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'message'"));
        }
        
        try {
            Map<String, Object> callResult = voiceService.initiateCall(toNumber);
            String callControlId = (String) callResult.get("call_control_id");
            
            Map<String, Object> ttsResult = voiceService.playTts(callControlId, message);
            
            Map<String, Object> response = new HashMap<>();
            response.put("call_control_id", callControlId);
            response.put("to", toNumber);
            response.put("message", message);
            response.put("status", "call_initiated_with_tts");
            
            return ResponseEntity.ok(response);
            
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (RateLimitException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } catch (ApiException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", e.getMessage()));
        } catch (ApiConnectionException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("error", "Network error connecting to Telnyx"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }
    
    @PostMapping("/speak/{callControlId}")
    public ResponseEntity<?> speak(@PathVariable String callControlId, 
                                   @RequestBody Map<String, String> request) {
        String message = request.get("message");
        
        if (message == null || message.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'message'"));
        }
        
        try {
            Map<String, Object> result = voiceService.playTts(callControlId, message);
            return ResponseEntity.ok(result);
            
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (RateLimitException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } catch (ApiException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", e.getMessage()));
        } catch (ApiConnectionException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("error", "Network error connecting to Telnyx"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }
}

// src/main/java/com/telnyx/controller/WebhookController.java
package com.telnyx.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/webhooks")
public class WebhookController {
    
    @PostMapping("/voice")
    public ResponseEntity<?> handleVoiceEvent(@RequestBody Map<String, Object> payload) {
        String eventType = (String) payload.get("data.event_type");
        String callControlId = (String) payload.get("data.call_control_id");
        
        System.out.println("Received event: " + eventType + " for call: " + callControlId);
        
        if ("call.answered".equals(eventType)) {
            System.out.println("Call answered: " + callControlId);
        } else if ("call.hangup".equals(eventType)) {
            System.out.println("Call ended: " + callControlId);
        } else if ("call.speak.ended".equals(eventType)) {
            System.out.println("TTS playback completed: " + callControlId);
        }
        
        return ResponseEntity.ok(Map.of("status", "received"));
    }
}
