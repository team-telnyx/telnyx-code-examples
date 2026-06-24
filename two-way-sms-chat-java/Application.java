// pom.xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.telnyx</groupId>
  <artifactId>telnyx-sms-app</artifactId>
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
spring.application.name=telnyx-sms-app
server.port=8080
telnyx.api.key=${TELNYX_API_KEY}
telnyx.phone.number=${TELNYX_PHONE_NUMBER}
telnyx.webhook.secret=${TELNYX_WEBHOOK_SECRET:}

// src/main/java/com/telnyx/TelnyxSmsApplication.java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class TelnyxSmsApplication {
    public static void main(String[] args) {
        SpringApplication.run(TelnyxSmsApplication.class, args);
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

// src/main/java/com/telnyx/service/SmsService.java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.TelnyxException;
import com.telnyx.model.MessageCreateRequest;
import com.telnyx.model.MessageCreateResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class SmsService {
    @Autowired
    private TelnyxClient telnyxClient;
    
    @Value("${telnyx.phone.number}")
    private String fromNumber;
    
    public Map<String, Object> sendSms(String toNumber, String messageText) throws TelnyxException {
        if (toNumber == null || !toNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                "Phone number must be in E.164 format (e.g., +15551234567)"
            );
        }
        
        if (messageText == null || messageText.trim().isEmpty()) {
            throw new IllegalArgumentException("Message text cannot be empty");
        }
        
        MessageCreateRequest request = new MessageCreateRequest()
            .setFrom(fromNumber)
            .setTo(toNumber)
            .setText(messageText);
        
        MessageCreateResponse response = telnyxClient.messages().create(request);
        
        Map<String, Object> result = new HashMap<>();
        result.put("message_id", response.getData().getId());
        result.put("status", response.getData().getTo() != null && !response.getData().getTo().isEmpty()
            ? response.getData().getTo().get(0).getStatus()
            : "unknown");
        result.put("from", fromNumber);
        result.put("to", toNumber);
        result.put("direction", "outbound");
        
        return result;
    }
}

// src/main/java/com/telnyx/controller/SmsController.java
package com.telnyx.controller;

import com.telnyx.service.SmsService;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/sms")
public class SmsController {
    @Autowired
    private SmsService smsService;
    
    @PostMapping("/send")
    public ResponseEntity<?> sendSms(@RequestBody Map<String, String> payload) {
        String toNumber = payload.get("to");
        String messageText = payload.get("message");
        
        if (toNumber == null || messageText == null) {
            Map<String, String> error = new HashMap<>();
            error.put("error", "Missing required fields: 'to' and 'message'");
            return ResponseEntity.badRequest().body(error);
        }
        
        try {
            Map<String, Object> result = smsService.sendSms(toNumber, messageText);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            Map<String, String> error = new HashMap<>();
            error.put("error", e.getMessage());
            return ResponseEntity.badRequest().body(error);
        } catch (AuthenticationException e) {
            Map<String, String> error = new HashMap<>();
            error.put("error", "Invalid API key");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error);
        } catch (RateLimitException e) {
            Map<String, String> error = new HashMap<>();
            error.put("error", "Rate limit exceeded. Please slow down.");
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(error);
        } catch (TelnyxException e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", e.getMessage());
            error.put("status_code", 500);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
        }
    }
    
    @PostMapping("/webhook")
    public ResponseEntity<?> handleWebhook(@RequestBody Map<String, Object> payload) {
        String eventType = (String) payload.get("type");
        
        if ("message.received".equals(eventType)) {
            Map<String, Object> data = (Map<String, Object>) payload.get("data");
            String messageId = (String) data.get("id");
            String from = (String) data.get("from");
            String text = (String) data.get("text");
            
            System.out.println("Inbound SMS received:");
            System.out.println("  Message ID: " + messageId);
            System.out.println("  From: " + from);
            System.out.println("  Text: " + text);
        } else if ("message.finalized".equals(eventType)) {
            Map<String, Object> data = (Map<String, Object>) payload.get("data");
            String messageId = (String) data.get("id");
            String direction = (String) data.get("direction");
            
            System.out.println("Message status update:");
            System.out.println("  Message ID: " + messageId);
            System.out.println("  Direction: " + direction);
            
            if (data.containsKey("to") && data.get("to") instanceof java.util.List) {
                java.util.List<Map<String, Object>> toList = 
                    (java.util.List<Map<String, Object>>) data.get("to");
                if (!toList.isEmpty()) {
                    String status = (String) toList.get(0).get("status");
                    System.out.println("  Status: " + status);
                }
            }
        }
        
        Map<String, String> response = new HashMap<>();
        response.put("status", "received");
        return ResponseEntity.ok(response);
    }
    
    @GetMapping("/health")
    public ResponseEntity<?> health() {
        Map<String, String> response = new HashMap<>();
        response.put("status", "ok");
        return ResponseEntity.ok(response);
    }
}
