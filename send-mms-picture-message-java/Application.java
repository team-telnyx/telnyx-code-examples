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

// src/main/java/com/telnyx/service/MmsService.java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.TelnyxException;
import com.telnyx.model.MessageCreateResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

@Service
public class MmsService {
    
    @Autowired
    private TelnyxClient telnyxClient;
    
    @Value("${telnyx.phone.number}")
    private String fromNumber;
    
    public Map<String, Object> sendMms(String toNumber, String message, String[] mediaUrls) 
            throws TelnyxException {
        
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                "Phone number must be in E.164 format (e.g., +15551234567)"
            );
        }
        
        if (mediaUrls == null || mediaUrls.length == 0) {
            throw new IllegalArgumentException(
                "At least one media URL is required for MMS"
            );
        }
        
        for (String url : mediaUrls) {
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                throw new IllegalArgumentException(
                    "Media URLs must be HTTP(S) accessible: " + url
                );
            }
        }
        
        MessageCreateResponse response = telnyxClient.messages().create(
            new HashMap<String, Object>() {{
                put("from_", fromNumber);
                put("to", toNumber);
                put("text", message);
                put("media_urls", Arrays.asList(mediaUrls));
            }}
        );
        
        Map<String, Object> result = new HashMap<>();
        result.put("message_id", response.getData().getId());
        result.put("status", response.getData().getTo() != null && !response.getData().getTo().isEmpty() 
            ? response.getData().getTo().get(0).getStatus() 
            : "unknown");
        result.put("from", fromNumber);
        result.put("to", toNumber);
        result.put("media_count", mediaUrls.length);
        
        return result;
    }
}

// src/main/java/com/telnyx/controller/MmsRequest.java
package com.telnyx.controller;

public class MmsRequest {
    private String to;
    private String message;
    private String[] mediaUrls;
    
    public String getTo() {
        return to;
    }
    
    public void setTo(String to) {
        this.to = to;
    }
    
    public String getMessage() {
        return message;
    }
    
    public void setMessage(String message) {
        this.message = message;
    }
    
    public String[] getMediaUrls() {
        return mediaUrls;
    }
    
    public void setMediaUrls(String[] mediaUrls) {
        this.mediaUrls = mediaUrls;
    }
}

// src/main/java/com/telnyx/controller/MmsController.java
package com.telnyx.controller;

import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import com.telnyx.service.MmsService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/mms")
public class MmsController {
    
    @Autowired
    private MmsService mmsService;
    
    @PostMapping("/send")
    public ResponseEntity<Map<String, Object>> sendMms(@RequestBody MmsRequest request) {
        if (request.getTo() == null || request.getTo().isEmpty()) {
            return ResponseEntity.badRequest().body(
                Map.of("error", "Missing required field: 'to'")
            );
        }
        
        if (request.getMessage() == null || request.getMessage().isEmpty()) {
            return ResponseEntity.badRequest().body(
                Map.of("error", "Missing required field: 'message'")
            );
        }
        
        if (request.getMediaUrls() == null || request.getMediaUrls().length == 0) {
            return ResponseEntity.badRequest().body(
                Map.of("error", "Missing required field: 'media_urls' (at least one URL required)")
            );
        }
        
        try {
            Map<String, Object> result = mmsService.sendMms(
                request.getTo(),
                request.getMessage(),
                request.getMediaUrls()
            );
            return ResponseEntity.ok(result);
            
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(
                Map.of("error", "Invalid API key")
            );
        } catch (RateLimitException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(
                Map.of("error", "Rate limit exceeded. Please slow down.")
            );
        } catch (TelnyxException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(
                Map.of("error", e.getMessage())
            );
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(
                Map.of("error", e.getMessage())
            );
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                Map.of("error", "Internal server error: " + e.getMessage())
            );
        }
    }
    
    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<Map<String, Object>> handleAuthenticationException(AuthenticationException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(
            Map.of("error", "Authentication failed: " + e.getMessage())
        );
    }
    
    @ExceptionHandler(RateLimitException.class)
    public ResponseEntity<Map<String, Object>> handleRateLimitException(RateLimitException e) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(
            Map.of("error", "Rate limit exceeded")
        );
    }
    
    @ExceptionHandler(TelnyxException.class)
    public ResponseEntity<Map<String, Object>> handleTelnyxException(TelnyxException e) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(
            Map.of("error", "Telnyx API error: " + e.getMessage())
        );
    }
}

// src/main/java/com/telnyx/MmsSenderApplication.java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class MmsSenderApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(MmsSenderApplication.class, args);
    }
}

// src/main/resources/application.properties
telnyx.api.key=${TELNYX_API_KEY}
telnyx.phone.number=${TELNYX_PHONE_NUMBER}
server.port=8080

// pom.xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    
    <groupId>com.telnyx</groupId>
    <artifactId>mms-sender</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>
    
    <name>MMS Sender</name>
    <description>Spring Boot MMS sender using Telnyx API</description>
    
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>2.7.0</version>
        <relativePath/>
    </parent>
    
    <properties>
        <java.version>11</java.version>
    </properties>
    
    <dependencies>
        <dependency>
            <groupId>com.telnyx</groupId>
            <artifactId>telnyx-java</artifactId>
            <version>2.0.0</version>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
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
