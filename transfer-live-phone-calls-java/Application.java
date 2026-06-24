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

// src/main/java/com/telnyx/service/CallService.java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.TelnyxException;
import com.telnyx.model.CallDialResponse;
import com.telnyx.model.CallTransferResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class CallService {
    
    @Autowired
    private TelnyxClient client;
    
    @Value("${TELNYX_PHONE_NUMBER}")
    private String fromNumber;
    
    @Value("${TELNYX_CONNECTION_ID}")
    private String connectionId;
    
    public Map<String, String> initiateCall(String toNumber) throws TelnyxException {
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException("Phone number must be in E.164 format (e.g., +15551234567)");
        }
        
        CallDialResponse response = client.calls.dial(
            fromNumber,
            toNumber,
            connectionId
        );
        
        return Map.of(
            "call_control_id", response.getData().getCallControlId(),
            "from", fromNumber,
            "to", toNumber,
            "status", "initiated"
        );
    }
    
    public Map<String, String> transferCall(String callControlId, String transferTo) throws TelnyxException {
        if (!transferTo.startsWith("+")) {
            throw new IllegalArgumentException("Transfer number must be in E.164 format");
        }
        
        CallTransferResponse response = client.calls.actions.transfer(
            callControlId,
            transferTo
        );
        
        return Map.of(
            "call_control_id", response.getData().getCallControlId(),
            "transfer_to", transferTo,
            "status", "transfer_initiated"
        );
    }
}

// src/main/java/com/telnyx/controller/CallController.java
package com.telnyx.controller;

import com.telnyx.exception.AuthenticationError;
import com.telnyx.exception.RateLimitError;
import com.telnyx.exception.APIStatusError;
import com.telnyx.exception.APIConnectionError;
import com.telnyx.service.CallService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/calls")
public class CallController {
    
    @Autowired
    private CallService callService;
    
    @PostMapping("/initiate")
    public ResponseEntity<?> initiateCall(@RequestBody Map<String, String> request) {
        String toNumber = request.get("to");
        
        if (toNumber == null || toNumber.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'to'"));
        }
        
        try {
            Map<String, String> result = callService.initiateCall(toNumber);
            return ResponseEntity.ok(result);
            
        } catch (AuthenticationError e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (RateLimitError e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } catch (APIStatusError e) {
            return ResponseEntity.status(e.getStatusCode())
                .body(Map.of("error", e.getMessage(), "status_code", String.valueOf(e.getStatusCode())));
        } catch (APIConnectionError e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("error", "Network error connecting to Telnyx"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        }
    }
    
    @PostMapping("/transfer")
    public ResponseEntity<?> transferCall(@RequestBody Map<String, String> request) {
        String callControlId = request.get("call_control_id");
        String transferTo = request.get("transfer_to");
        
        if (callControlId == null || callControlId.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'call_control_id'"));
        }
        
        if (transferTo == null || transferTo.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'transfer_to'"));
        }
        
        try {
            Map<String, String> result = callService.transferCall(callControlId, transferTo);
            return ResponseEntity.ok(result);
            
        } catch (AuthenticationError e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (RateLimitError e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } catch (APIStatusError e) {
            return ResponseEntity.status(e.getStatusCode())
                .body(Map.of("error", e.getMessage(), "status_code", String.valueOf(e.getStatusCode())));
        } catch (APIConnectionError e) {
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
    
    @PostMapping("/call-events")
    public ResponseEntity<?> handleCallEvent(@RequestBody Map<String, Object> payload) {
        String eventType = (String) payload.get("data.event_type");
        String callControlId = (String) payload.get("data.call_control_id");
        
        System.out.println("Received event: " + eventType + " for call: " + callControlId);
        
        if ("call.initiated".equals(eventType)) {
            System.out.println("Call initiated: " + callControlId);
        } else if ("call.answered".equals(eventType)) {
            System.out.println("Call answered: " + callControlId);
        } else if ("call.hangup".equals(eventType)) {
            System.out.println("Call ended: " + callControlId);
        }
        
        return ResponseEntity.ok(Map.of("status", "received"));
    }
}

// src/main/java/com/telnyx/CallTransferApplication.java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class CallTransferApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(CallTransferApplication.class, args);
    }
}

// src/main/resources/application.properties
TELNYX_API_KEY=YOUR_API_KEY_HERE
TELNYX_PHONE_NUMBER=+15551234567
TELNYX_CONNECTION_ID=YOUR_CONNECTION_ID_HERE
server.port=8080

// pom.xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    
    <groupId>com.telnyx</groupId>
    <artifactId>call-transfer-app</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>
    
    <name>Call Transfer App</name>
    <description>Telnyx Call Transfer with Spring Boot</description>
    
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.1.0</version>
        <relativePath/>
    </parent>
    
    <properties>
        <java.version>11</java.version>
    </properties>
    
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
