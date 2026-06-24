// pom.xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.telnyx</groupId>
    <artifactId>call-recording-app</artifactId>
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
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
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

// src/main/resources/application.properties
server.port=8080
telnyx.api.key=${TELNYX_API_KEY}
telnyx.phone.number=${TELNYX_PHONE_NUMBER}
telnyx.connection.id=${TELNYX_CONNECTION_ID}

// src/main/java/com/telnyx/CallRecordingApplication.java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class CallRecordingApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(CallRecordingApplication.class, args);
    }
}

// src/main/java/com/telnyx/config/TelnyxConfig.java
package com.telnyx.config;

import com.telnyx.TelnyxClient;
import com.telnyx.TelnyxOkHttpClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TelnyxConfig {
    
    @Bean
    public TelnyxClient telnyxClient() {
        return TelnyxOkHttpClient.fromEnv();
    }
}

// src/main/java/com/telnyx/service/CallRecordingService.java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.model.CallDialResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class CallRecordingService {
    
    private final TelnyxClient telnyxClient;
    
    @Value("${telnyx.phone.number}")
    private String fromNumber;
    
    @Value("${telnyx.connection.id}")
    private String connectionId;
    
    @Autowired
    public CallRecordingService(TelnyxClient telnyxClient) {
        this.telnyxClient = telnyxClient;
    }
    
    public Map<String, Object> initiateCallWithRecording(String toNumber) {
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                "Phone number must be in E.164 format (e.g., +15551234567)"
            );
        }
        
        Map<String, Object> params = new HashMap<>();
        params.put("from_", fromNumber);
        params.put("to", toNumber);
        params.put("connection_id", connectionId);
        params.put("record", true);
        params.put("record_format", "wav");
        
        CallDialResponse response = telnyxClient.calls().dial(params);
        
        Map<String, Object> result = new HashMap<>();
        result.put("call_control_id", response.getData().getCallControlId());
        result.put("from", fromNumber);
        result.put("to", toNumber);
        result.put("recording_enabled", true);
        
        return result;
    }
    
    public Map<String, Object> stopRecording(String callControlId) {
        Map<String, Object> params = new HashMap<>();
        params.put("command_id", callControlId);
        
        telnyxClient.calls().actions().stopRecording(callControlId, params);
        
        Map<String, Object> result = new HashMap<>();
        result.put("call_control_id", callControlId);
        result.put("action", "stop_recording");
        result.put("status", "requested");
        
        return result;
    }
}

// src/main/java/com/telnyx/controller/CallRecordingController.java
package com.telnyx.controller;

import com.telnyx.service.CallRecordingService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/calls")
public class CallRecordingController {
    
    private final CallRecordingService callRecordingService;
    
    @Autowired
    public CallRecordingController(CallRecordingService callRecordingService) {
        this.callRecordingService = callRecordingService;
    }
    
    @PostMapping("/initiate")
    public ResponseEntity<?> initiateCall(@RequestBody Map<String, String> request) {
        String toNumber = request.get("to");
        
        if (toNumber == null || toNumber.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'to'"));
        }
        
        try {
            Map<String, Object> result = callRecordingService.initiateCallWithRecording(toNumber);
            return ResponseEntity.ok(result);
            
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }
    
    @PostMapping("/{callControlId}/stop-recording")
    public ResponseEntity<?> stopRecording(@PathVariable String callControlId) {
        try {
            Map<String, Object> result = callRecordingService.stopRecording(callControlId);
            return ResponseEntity.ok(result);
            
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Failed to stop recording: " + e.getMessage()));
        }
    }
    
    @PostMapping("/webhooks/call-events")
    public ResponseEntity<?> handleCallEvent(@RequestBody Map<String, Object> event) {
        String eventType = (String) event.get("data.event_type");
        String callControlId = (String) event.get("data.call_control_id");
        
        System.out.println("Received event: " + eventType + " for call: " + callControlId);
        
        if ("call.initiated".equals(eventType)) {
            System.out.println("Call initiated: " + callControlId);
        } else if ("call.answered".equals(eventType)) {
            System.out.println("Call answered: " + callControlId);
        } else if ("call.recording.saved".equals(eventType)) {
            String recordingUrl = (String) event.get("data.recording_urls.0");
            System.out.println("Recording saved for call " + callControlId + ": " + recordingUrl);
        } else if ("call.hangup".equals(eventType)) {
            System.out.println("Call ended: " + callControlId);
        }
        
        return ResponseEntity.ok(Map.of("status", "received"));
    }
}

// src/main/java/com/telnyx/exception/GlobalExceptionHandler.java
package com.telnyx.exception;

import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

import java.util.Map;

@ControllerAdvice
public class GlobalExceptionHandler {
    
    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<?> handleAuthenticationError(AuthenticationException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
            .body(Map.of("error", "Invalid API key: " + e.getMessage()));
    }
    
    @ExceptionHandler(RateLimitException.class)
    public ResponseEntity<?> handleRateLimitError(RateLimitException e) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
            .body(Map.of("error", "Rate limit exceeded. Please slow down."));
    }
    
    @ExceptionHandler(TelnyxException.class)
    public ResponseEntity<?> handleTelnyxError(TelnyxException e) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
            .body(Map.of("error", "Telnyx API error: " + e.getMessage()));
    }
    
    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> handleGenericError(Exception e) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Map.of("error", "Internal server error: " + e.getMessage()));
    }
}
