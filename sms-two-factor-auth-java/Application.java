// pom.xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.example</groupId>
    <artifactId>telnyx-otp-2fa</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.1.0</version>
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
spring.application.name=telnyx-otp-2fa
server.port=8080

telnyx.api.key=${TELNYX_API_KEY}
telnyx.phone.number=${TELNYX_PHONE_NUMBER}

otp.length=6
otp.expiry.seconds=300
otp.max.attempts=3

// src/main/java/com/example/TelnyxOtpApplication.java
package com.example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class TelnyxOtpApplication {
    public static void main(String[] args) {
        SpringApplication.run(TelnyxOtpApplication.class, args);
    }
}

// src/main/java/com/example/config/TelnyxConfig.java
package com.example.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TelnyxConfig {
    
    @Value("${telnyx.api.key}")
    private String apiKey;
    
    @Value("${telnyx.phone.number}")
    private String phoneNumber;
    
    @Value("${otp.length:6}")
    private int otpLength;
    
    @Value("${otp.expiry.seconds:300}")
    private int otpExpirySeconds;
    
    @Value("${otp.max.attempts:3}")
    private int otpMaxAttempts;
    
    public String getApiKey() {
        return apiKey;
    }
    
    public String getPhoneNumber() {
        return phoneNumber;
    }
    
    public int getOtpLength() {
        return otpLength;
    }
    
    public int getOtpExpirySeconds() {
        return otpExpirySeconds;
    }
    
    public int getOtpMaxAttempts() {
        return otpMaxAttempts;
    }
}

// src/main/java/com/example/service/OtpService.java
package com.example.service;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.springframework.stereotype.Service;
import com.example.config.TelnyxConfig;

@Service
public class OtpService {
    
    private final TelnyxConfig config;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, OtpRecord> otpStore = new HashMap<>();
    
    public OtpService(TelnyxConfig config) {
        this.config = config;
    }
    
    public String generateOtp(String phoneNumber) {
        String otp = generateRandomOtp();
        long expiresAt = Instant.now().getEpochSecond() + config.getOtpExpirySeconds();
        otpStore.put(phoneNumber, new OtpRecord(otp, expiresAt, 0));
        return otp;
    }
    
    public boolean validateOtp(String phoneNumber, String providedOtp) {
        OtpRecord record = otpStore.get(phoneNumber);
        
        if (record == null) {
            return false;
        }
        
        if (Instant.now().getEpochSecond() > record.expiresAt) {
            otpStore.remove(phoneNumber);
            return false;
        }
        
        if (record.attempts >= config.getOtpMaxAttempts()) {
            otpStore.remove(phoneNumber);
            return false;
        }
        
        record.attempts++;
        
        if (record.otp.equals(providedOtp)) {
            otpStore.remove(phoneNumber);
            return true;
        }
        
        return false;
    }
    
    public int getRemainingAttempts(String phoneNumber) {
        OtpRecord record = otpStore.get(phoneNumber);
        if (record == null) {
            return config.getOtpMaxAttempts();
        }
        return config.getOtpMaxAttempts() - record.attempts;
    }
    
    private String generateRandomOtp() {
        int otp = random.nextInt((int) Math.pow(10, config.getOtpLength()));
        return String.format("%0" + config.getOtpLength() + "d", otp);
    }
    
    private static class OtpRecord {
        String otp;
        long expiresAt;
        int attempts;
        
        OtpRecord(String otp, long expiresAt, int attempts) {
            this.otp = otp;
            this.expiresAt = expiresAt;
            this.attempts = attempts;
        }
    }
}

// src/main/java/com/example/service/SmsService.java
package com.example.service;

import com.telnyx.sdk.ApiClient;
import com.telnyx.sdk.ApiException;
import com.telnyx.sdk.api.MessagesApi;
import com.telnyx.sdk.model.CreateMessageRequest;
import com.telnyx.sdk.model.MessageResponse;
import org.springframework.stereotype.Service;
import com.example.config.TelnyxConfig;

@Service
public class SmsService {
    
    private final TelnyxConfig config;
    private final MessagesApi messagesApi;
    
    public SmsService(TelnyxConfig config) {
        this.config = config;
        ApiClient apiClient = new ApiClient();
        apiClient.setApiKey(config.getApiKey());
        this.messagesApi = new MessagesApi(apiClient);
    }
    
    public String sendOtpSms(String toNumber, String otp) throws ApiException {
        CreateMessageRequest request = new CreateMessageRequest();
        request.setFrom(config.getPhoneNumber());
        request.setTo(toNumber);
        request.setText("Your verification code is: " + otp + ". Valid for 5 minutes.");
        
        MessageResponse response = messagesApi.createMessage(request);
        return response.getData().getId();
    }
}

// src/main/java/com/example/controller/OtpController.java
package com.example.controller;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.example.service.OtpService;
import com.example.service.SmsService;
import com.telnyx.sdk.ApiException;

@RestController
@RequestMapping("/api/otp")
public class OtpController {
    
    private final OtpService otpService;
    private final SmsService smsService;
    
    public OtpController(OtpService otpService, SmsService smsService) {
        this.otpService = otpService;
        this.smsService = smsService;
    }
    
    @PostMapping("/request")
    public ResponseEntity<?> requestOtp(@RequestBody Map<String, String> request) {
        String phoneNumber = request.get("phone_number");
        
        if (phoneNumber == null || phoneNumber.trim().isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: phone_number"));
        }
        
        if (!phoneNumber.startsWith("+")) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Phone number must be in E.164 format (e.g., +15551234567)"));
        }
        
        try {
            String otp = otpService.generateOtp(phoneNumber);
            String messageId = smsService.sendOtpSms(phoneNumber, otp);
            
            return ResponseEntity.ok(Map.of(
                "message_id", messageId,
                "status", "otp_sent",
                "phone_number", phoneNumber,
                "expires_in_seconds", 300
            ));
            
        } catch (ApiException e) {
            return handleTelnyxException(e);
        }
    }
    
    @PostMapping("/verify")
    public ResponseEntity<?> verifyOtp(@RequestBody Map<String, String> request) {
        String phoneNumber = request.get("phone_number");
        String otp = request.get("otp");
        
        if (phoneNumber == null || phoneNumber.trim().isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: phone_number"));
        }
        
        if (otp == null || otp.trim().isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: otp"));
        }
        
        if (otpService.validateOtp(phoneNumber, otp)) {
            return ResponseEntity.ok(Map.of(
                "status", "verified",
                "phone_number", phoneNumber,
                "message", "OTP verified successfully"
            ));
        } else {
            int remainingAttempts = otpService.getRemainingAttempts(phoneNumber);
            
            if (remainingAttempts <= 0) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of(
                        "error", "Maximum verification attempts exceeded",
                        "remaining_attempts", 0
                    ));
            }
            
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of(
                    "error", "Invalid or expired OTP",
                    "remaining_attempts", remainingAttempts
                ));
        }
    }
    
    private ResponseEntity<?> handleTelnyxException(ApiException e) {
        int statusCode = e.getCode();
        
        if (statusCode == 401) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } else if (statusCode == 429) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } else if (statusCode >= 500) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("error", "Telnyx service unavailable"));
        } else {
            return ResponseEntity.status(statusCode)
                .body(Map.of("error", e.getMessage(), "status_code", statusCode));
        }
    }
}
