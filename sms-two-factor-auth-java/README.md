# OTP 2FA with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that implements two-factor authentication (2FA) using one-time passwords (OTPs) delivered via SMS. This tutorial demonstrates secure OTP generation, storage, validation, and delivery using the Telnyx Java SDK with proper error handling and rate limiting.

## Who Is This For?

- **Java developers** building sms features with Spring.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Java 11 or higher.
- Maven 3.6+ or Gradle 6.0+.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound SMS.
- Spring Boot 2.7+ or 3.0+.
- Postman or curl for testing endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-java
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create an OTP service to generate, store, and validate one-time passwords:

```java
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
    
    // In-memory storage: phone -> {otp, expiresAt, attempts}
    private final Map<String, OtpRecord> otpStore = new HashMap<>();
    
    public OtpService(TelnyxConfig config) {
        this.config = config;
    }
    
    /**
     * Generate a new OTP for the given phone number.
     * Overwrites any existing OTP for that number.
     */
    public String generateOtp(String phoneNumber) {
        String otp = generateRandomOtp();
        long expiresAt = Instant.now().getEpochSecond() + config.getOtpExpirySeconds();
        otpStore.put(phoneNumber, new OtpRecord(otp, expiresAt, 0));
        return otp;
    }
    
    /**
     * Validate an OTP for the given phone number.
     * Returns true if OTP is correct and not expired.
     * Increments attempt counter and returns false if max attempts exceeded.
     */
    public boolean validateOtp(String phoneNumber, String providedOtp) {
        OtpRecord record = otpStore.get(phoneNumber);
        
        if (record == null) {
            return false;
        }
        
        // Check if OTP has expired
        if (Instant.now().getEpochSecond() > record.expiresAt) {
            otpStore.remove(phoneNumber);
            return false;
        }
        
        // Check if max attempts exceeded
        if (record.attempts >= config.getOtpMaxAttempts()) {
            otpStore.remove(phoneNumber);
            return false;
        }
        
        // Increment attempt counter
        record.attempts++;
        
        // Validate OTP
        if (record.otp.equals(providedOtp)) {
            otpStore.remove(phoneNumber);
            return true;
        }
        
        return false;
    }
    
    /**
     * Get remaining attempts for a phone number.
     */
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
    
    // Inner class to store OTP metadata
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
```

Create an SMS service to send OTP messages via Telnyx:

```java
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
    
    /**
     * Send OTP via SMS to the specified phone number.
     * Returns the message ID on success.
     */
    public String sendOtpSms(String toNumber, String otp) throws ApiException {
        CreateMessageRequest request = new CreateMessageRequest();
        request.setFrom(config.getPhoneNumber());
        request.setTo(toNumber);
        request.setText("Your verification code is: " + otp + ". Valid for 5 minutes.");
        
        MessageResponse response = messagesApi.createMessage(request);
        return response.getData().getId();
    }
}
```

Create a REST controller to handle OTP requests:

```java
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
    
    /**
     * POST /api/otp/request
     * Request an OTP to be sent to the specified phone number.
     */
    @PostMapping("/request")
    public ResponseEntity<?> requestOtp(@RequestBody Map<String, String> request) {
        String phoneNumber = request.get("phone_number");
        
        if (phoneNumber == null || phoneNumber.trim().isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: phone_number"));
        }
        
        // Validate E.164 format
        if (!phoneNumber.startsWith("+")) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Phone number must be in E.164 format (e.g., +15551234567)"));
        }
        
        try {
            // Generate OTP
            String otp = otpService.generateOtp(phoneNumber);
            
            // Send OTP via SMS
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
    
    /**
     * POST /api/otp/verify
     * Verify the OTP provided by the user.
     */
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
        
        // Validate OTP
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
    
    /**
     * Handle Telnyx API exceptions and map to appropriate HTTP status codes.
     */
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
```

Create the main Spring Boot application class:

```java
package com.example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class TelnyxOtpApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(TelnyxOtpApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-two-factor-auth-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Spring Boot application after updating the environment variable. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| OTP Expired Before Verification | The endpoint returns `{"error": "Invalid or expired OTP"}` even though the OTP was just sent. | Verify that the OTP expiry time in `application.properties` is sufficient for your use case. The default is 300 seconds (5 minutes). Increase `otp.expiry.seconds` if needed. Ensure the server clock is synchronized with the client's clock. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx enforces rate limits on API requests. Implement exponential backoff in your client code and space out OTP requests. Consider caching OTP requests per phone number to avoid duplicate sends within a short time window. |
| Maximum Attempts Exceeded | The endpoint returns `{"error": "Maximum verification attempts exceeded"}` with HTTP 403. | The user has exceeded the maximum number of OTP verification attempts (default: 3). Require the user to request a new OTP via the `/api/otp/request` endpoint. Consider implementing a cooldown period before allowing new OTP requests. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Java version do I need?**

Java 17 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Send a Single SMS with Java and Spring](/tutorials/sms/java/send-single-sms).
- [Send Bulk SMS Messages with Java and Spring](/tutorials/sms/java/send-bulk-sms).
- [Receive SMS Webhooks with Java and Spring](/tutorials/sms/java/receive-sms-webhook).
