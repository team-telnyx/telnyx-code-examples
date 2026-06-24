// pom.xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.telnyx</groupId>
    <artifactId>sms-autoresponder</artifactId>
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
            <groupId>com.google.code.gson</groupId>
            <artifactId>gson</artifactId>
            <version>2.10.1</version>
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
spring.application.name=sms-autoresponder
logging.level.root=INFO
logging.level.com.telnyx=DEBUG

// src/main/java/com/telnyx/sms/TelnyxConfig.java
package com.telnyx.sms;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TelnyxConfig {
    
    @Value("${TELNYX_API_KEY:}")
    private String apiKey;
    
    @Value("${TELNYX_PHONE_NUMBER:}")
    private String phoneNumber;
    
    @Value("${WEBHOOK_URL:}")
    private String webhookUrl;
    
    public String getApiKey() {
        return apiKey;
    }
    
    public String getPhoneNumber() {
        return phoneNumber;
    }
    
    public String getWebhookUrl() {
        return webhookUrl;
    }
}

// src/main/java/com/telnyx/sms/SmsService.java
package com.telnyx.sms;

import com.telnyx.sdk.TelnyxClient;
import com.telnyx.sdk.TelnyxOkHttpClient;
import com.telnyx.sdk.exception.AuthenticationException;
import com.telnyx.sdk.exception.RateLimitException;
import com.telnyx.sdk.exception.TelnyxException;
import com.telnyx.sdk.model.Message;
import com.telnyx.sdk.model.MessageCreateRequest;
import com.telnyx.sdk.model.MessageResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class SmsService {
    
    private static final Logger logger = LoggerFactory.getLogger(SmsService.class);
    private final TelnyxClient client;
    private final TelnyxConfig config;
    
    public SmsService(TelnyxConfig config) {
        this.config = config;
        this.client = TelnyxOkHttpClient.fromEnv();
    }
    
    public Message sendSms(String toNumber, String message) throws TelnyxException {
        String fromNumber = config.getPhoneNumber();
        
        if (fromNumber == null || fromNumber.isEmpty()) {
            throw new IllegalArgumentException("TELNYX_PHONE_NUMBER environment variable not set");
        }
        
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                "Phone number must be in E.164 format (e.g., +15551234567)"
            );
        }
        
        logger.info("Sending SMS from {} to {}", fromNumber, toNumber);
        
        MessageCreateRequest request = new MessageCreateRequest();
        request.setFrom(fromNumber);
        request.setTo(toNumber);
        request.setText(message);
        
        MessageResponse response = client.messages().create(request);
        
        logger.info("Message sent with ID: {}", response.getData().getId());
        return response.getData();
    }
}

// src/main/java/com/telnyx/sms/WebhookController.java
package com.telnyx.sms;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.telnyx.sdk.exception.TelnyxException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/webhooks")
public class WebhookController {
    
    private static final Logger logger = LoggerFactory.getLogger(WebhookController.class);
    private final SmsService smsService;
    
    public WebhookController(SmsService smsService) {
        this.smsService = smsService;
    }
    
    @PostMapping("/sms")
    public ResponseEntity<Map<String, Object>> handleSmsWebhook(@RequestBody String payload) {
        try {
            logger.info("Received webhook payload: {}", payload);
            
            JsonObject json = JsonParser.parseString(payload).getAsJsonObject();
            
            if (!json.has("data")) {
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "Invalid webhook payload: missing 'data' field"));
            }
            
            JsonObject data = json.getAsJsonObject("data");
            String eventType = data.has("event_type") ? data.get("event_type").getAsString() : "";
            
            if (!"message.received".equals(eventType)) {
                logger.debug("Ignoring event type: {}", eventType);
                return ResponseEntity.ok(Map.of("status", "ignored"));
            }
            
            String fromNumber = data.has("from") ? data.get("from").getAsString() : null;
            String messageText = data.has("text") ? data.get("text").getAsString() : null;
            
            if (fromNumber == null || messageText == null) {
                logger.warn("Missing required fields in webhook payload");
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing 'from' or 'text' field"));
            }
            
            logger.info("Inbound SMS from {} with text: {}", fromNumber, messageText);
            
            String autoresponse = generateAutoresponse(messageText);
            
            smsService.sendSms(fromNumber, autoresponse);
            
            return ResponseEntity.ok(Map.of(
                "status", "success",
                "message", "Autoresponse sent",
                "from", fromNumber
            ));
            
        } catch (TelnyxException e) {
            logger.error("Telnyx API error: {}", e.getMessage(), e);
            return handleTelnyxException(e);
        } catch (Exception e) {
            logger.error("Unexpected error processing webhook: {}", e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Internal server error: " + e.getMessage()));
        }
    }
    
    private String generateAutoresponse(String inboundMessage) {
        String lower = inboundMessage.toLowerCase();
        
        if (lower.contains("hello") || lower.contains("hi")) {
            return "Hello! Thanks for reaching out. We'll get back to you shortly.";
        } else if (lower.contains("help")) {
            return "We're here to help! Please describe your issue and we'll assist you.";
        } else if (lower.contains("hours")) {
            return "Our business hours are Monday-Friday, 9 AM - 5 PM EST.";
        } else {
            return "Thank you for your message. We've received it and will respond soon.";
        }
    }
    
    private ResponseEntity<Map<String, Object>> handleTelnyxException(TelnyxException e) {
        Map<String, Object> errorResponse = new HashMap<>();
        errorResponse.put("error", e.getMessage());
        
        if (e instanceof com.telnyx.sdk.exception.AuthenticationException) {
            errorResponse.put("code", "AUTHENTICATION_ERROR");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(errorResponse);
        } else if (e instanceof com.telnyx.sdk.exception.RateLimitException) {
            errorResponse.put("code", "RATE_LIMIT_EXCEEDED");
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(errorResponse);
        } else {
            errorResponse.put("code", "API_ERROR");
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(errorResponse);
        }
    }
}

// src/main/java/com/telnyx/sms/SmsAutoresponderApplication.java
package com.telnyx.sms;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class SmsAutoresponderApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(SmsAutoresponderApplication.class, args);
    }
}
