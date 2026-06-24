# CNAM Lookup with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot REST endpoint that performs CNAM (Caller Name) lookups using the Telnyx Java SDK. This tutorial demonstrates how to retrieve caller identification information for inbound calls, implement proper error handling for telecom APIs, and manage credentials securely via environment variables.

## Who Is This For?

- **Java developers** building sip features with Spring.
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
- Spring Boot 2.7+ installed.
- A phone number in E.164 format to perform CNAM lookups against.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-cnam-lookup-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a Spring configuration class to initialize the Telnyx client as a singleton bean:

```java
package com.telnyx.config;

import com.telnyx.TelnyxClient;
import com.telnyx.TelnyxOkHttpClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TelnyxConfig {
    
    @Bean
    public TelnyxClient telnyxClient() {
        // Initialize client from TELNYX_API_KEY environment variable
        return TelnyxOkHttpClient.fromEnv();
    }
}
```

Create a service class to handle CNAM lookup logic:

```java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import com.telnyx.model.CnamLookup;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class CnamLookupService {
    
    private final TelnyxClient telnyxClient;
    
    @Autowired
    public CnamLookupService(TelnyxClient telnyxClient) {
        this.telnyxClient = telnyxClient;
    }
    
    /**
     * Perform CNAM lookup for a given phone number.
     * Returns a map with caller name and carrier information.
     * 
     * @param phoneNumber Phone number in E.164 format (e.g., +15551234567)
     * @return Map containing CNAM lookup results
     * @throws IllegalArgumentException if phone number format is invalid
     * @throws TelnyxException if API call fails
     */
    public Map<String, Object> lookupCnam(String phoneNumber) {
        // Validate E.164 format to prevent API errors
        if (phoneNumber == null || !phoneNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                "Phone number must be in E.164 format (e.g., +15551234567)"
            );
        }
        
        // Call Telnyx CNAM lookup endpoint
        CnamLookup response = telnyxClient.cnamLookups().retrieve(phoneNumber);
        
        // Extract serializable data — SDK objects are NOT JSON-serializable
        Map<String, Object> result = new HashMap<>();
        result.put("phone_number", response.getData().getPhoneNumber());
        result.put("caller_name", response.getData().getCallerName());
        result.put("carrier_name", response.getData().getCarrierName());
        result.put("lookup_status", response.getData().getLookupStatus());
        
        return result;
    }
}
```

Create a REST controller to expose the CNAM lookup endpoint:

```java
package com.telnyx.controller;

import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import com.telnyx.service.CnamLookupService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/cnam")
public class CnamLookupController {
    
    private final CnamLookupService cnamLookupService;
    
    @Autowired
    public CnamLookupController(CnamLookupService cnamLookupService) {
        this.cnamLookupService = cnamLookupService;
    }
    
    /**
     * HTTP endpoint to perform CNAM lookup for a phone number.
     * 
     * @param phoneNumber Phone number in E.164 format (query parameter)
     * @return JSON response with caller name and carrier information
     */
    @GetMapping("/lookup")
    public ResponseEntity<?> lookupCnam(@RequestParam String phoneNumber) {
        try {
            Map<String, Object> result = cnamLookupService.lookupCnam(phoneNumber);
            return ResponseEntity.ok(result);
            
        } catch (AuthenticationException e) {
            // 401: Invalid API key
            Map<String, String> error = new HashMap<>();
            error.put("error", "Invalid API key");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error);
            
        } catch (RateLimitException e) {
            // 429: Rate limit exceeded
            Map<String, String> error = new HashMap<>();
            error.put("error", "Rate limit exceeded. Please slow down.");
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(error);
            
        } catch (TelnyxException e) {
            // Other API errors (4xx/5xx)
            Map<String, Object> error = new HashMap<>();
            error.put("error", e.getMessage());
            error.put("status_code", e.getStatusCode());
            return ResponseEntity.status(e.getStatusCode()).body(error);
            
        } catch (IllegalArgumentException e) {
            // Validation error
            Map<String, String> error = new HashMap<>();
            error.put("error", e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
        }
    }
}
```

Create the main Spring Boot application class:

```java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class CnamLookupApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(CnamLookupApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-cnam-lookup-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or special characters. Set the variable before starting the Spring Boot application: `export TELNYX_API_KEY=your_key_here`. Restart the application after updating the key. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). URL-encode the `+` character as `%2B` in curl requests: `phoneNumber=%2B15551234567`. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | CNAM lookups are rate-limited by Telnyx. Implement exponential backoff in your client code and cache results when possible. Wait at least 1 second between consecutive lookups for the same number. Check your Telnyx account plan for rate limit details in the [Portal](https://portal.telnyx.com). |
| CNAM Data Not Found | The response shows `"lookup_status": "not_found"` and `"caller_name": null`. | This is a valid response indicating the phone number exists but CNAM data is not available in the database. This is common for unlisted numbers, VoIP numbers, or international numbers. The carrier information will still be returned if available. No action is required—handle this case gracefully in your application. |
| Spring Boot Application Won't Start | The application fails to start with a bean initialization error or connection timeout. | Verify the Telnyx Java SDK is correctly added to `pom.xml` with version 2.0.0 or higher. Ensure the `TelnyxConfig` class is in a package that Spring can scan (typically under the main application package). Check that `TELNYX_API_KEY` is set in your environment before starting the application. Run `mvn clean install` to rebuild dependencies. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Java version do I need?**

Java 17 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [SIP Trunking Get Started](https://developers.telnyx.com/docs/voice/sip-trunking/get-started)
- [SIP Configuration Guides](https://developers.telnyx.com/docs/voice/sip-trunking/configuration-guides)
- [Telnyx SIP Trunks](https://telnyx.com/products/sip-trunks)
- [SIP Trunking Pricing](https://telnyx.com/pricing/elastic-sip)

## Related Examples

- [Set Up SIP Trunking with Java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/java/sip-trunking-setup).
- [Configure SIP Authentication](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/java/sip-authentication).
- [Route Inbound SIP Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/java/inbound-sip-routing).
