# Number Lookup with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot REST API that performs number lookups using the Telnyx Java SDK. This tutorial demonstrates how to validate phone numbers, retrieve carrier information, and handle telecom-specific errors in a Spring application. Number lookup is essential for verifying phone number validity before sending SMS, reducing failed message delivery and improving user experience.

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
- Maven 3.6+ or Gradle 7.0+.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- Spring Boot 2.7+ or 3.0+.
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/phone-number-lookup-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle number lookup logic:

```java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.APIConnectionException;
import com.telnyx.exception.APIException;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.model.numberlookup.NumberLookup;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class NumberLookupService {

    private final TelnyxClient telnyxClient;

    public NumberLookupService(TelnyxClient telnyxClient) {
        this.telnyxClient = telnyxClient;
    }

    /**
     * Perform a number lookup to retrieve carrier and validity information.
     * Returns a Map with serializable data — SDK objects are NOT JSON-serializable.
     */
    public Map<String, Object> lookupNumber(String phoneNumber) {
        // Validate E.164 format to prevent API errors
        if (phoneNumber == null || !phoneNumber.startsWith("+")) {
            throw new IllegalArgumentException(
                "Phone number must be in E.164 format (e.g., +15551234567)"
            );
        }

        // Call Telnyx API to perform number lookup
        NumberLookup response = telnyxClient.numberLookup().retrieve(phoneNumber);

        // Extract serializable data from SDK response object
        Map<String, Object> result = new HashMap<>();
        result.put("phone_number", response.getPhoneNumber());
        result.put("country_code", response.getCountryCode());
        result.put("national_format", response.getNationalFormat());
        result.put("carrier_name", response.getCarrierName());
        result.put("carrier_type", response.getCarrierType());
        result.put("line_type", response.getLineType());
        result.put("is_valid", response.getIsValid());
        result.put("portability_status", response.getPortabilityStatus());

        return result;
    }
}
```

Create a REST controller to expose the number lookup endpoint:

```java
package com.telnyx.controller;

import com.telnyx.exception.APIConnectionException;
import com.telnyx.exception.APIException;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.service.NumberLookupService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/number-lookup")
public class NumberLookupController {

    private final NumberLookupService numberLookupService;

    public NumberLookupController(NumberLookupService numberLookupService) {
        this.numberLookupService = numberLookupService;
    }

    /**
     * POST endpoint to perform a number lookup.
     * Request body: {"phone_number": "+15551234567"}
     */
    @PostMapping("/lookup")
    public ResponseEntity<Map<String, Object>> lookup(@RequestBody Map<String, String> request) {
        String phoneNumber = request.get("phone_number");

        if (phoneNumber == null || phoneNumber.isEmpty()) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "Missing required field: 'phone_number'");
            return ResponseEntity.badRequest().body(error);
        }

        try {
            Map<String, Object> result = numberLookupService.lookupNumber(phoneNumber);
            return ResponseEntity.ok(result);

        } catch (AuthenticationException e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "Invalid API key");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error);

        } catch (RateLimitException e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "Rate limit exceeded. Please slow down.");
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(error);

        } catch (APIException e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", e.getMessage());
            error.put("status_code", e.getStatusCode());
            return ResponseEntity.status(e.getStatusCode()).body(error);

        } catch (APIConnectionException e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "Network error connecting to Telnyx");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(error);

        } catch (IllegalArgumentException e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", e.getMessage());
            return ResponseEntity.badRequest().body(error);
        }
    }

    /**
     * GET endpoint to perform a number lookup via query parameter.
     * Usage: GET /api/number-lookup/lookup?phone_number=%2B15551234567
     */
    @GetMapping("/lookup")
    public ResponseEntity<Map<String, Object>> lookupGet(
            @RequestParam(name = "phone_number") String phoneNumber) {
        if (phoneNumber == null || phoneNumber.isEmpty()) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "Missing required parameter: 'phone_number'");
            return ResponseEntity.badRequest().body(error);
        }

        try {
            Map<String, Object> result = numberLookupService.lookupNumber(phoneNumber);
            return ResponseEntity.ok(result);

        } catch (AuthenticationException e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "Invalid API key");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error);

        } catch (RateLimitException e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "Rate limit exceeded. Please slow down.");
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(error);

        } catch (APIException e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", e.getMessage());
            error.put("status_code", e.getStatusCode());
            return ResponseEntity.status(e.getStatusCode()).body(error);

        } catch (APIConnectionException e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", "Network error connecting to Telnyx");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(error);

        } catch (IllegalArgumentException e) {
            Map<String, Object> error = new HashMap<>();
            error.put("error", e.getMessage());
            return ResponseEntity.badRequest().body(error);
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
public class NumberLookupApplication {

    public static void main(String[] args) {
        SpringApplication.run(NumberLookupApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/phone-number-lookup-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable is set correctly. Run `echo $TELNYX_API_KEY` to confirm the value. Ensure there are no trailing spaces or quotes. If the key was regenerated in the [Telnyx Portal](https://portal.telnyx.com), update your environment variable and restart the Spring Boot application. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid format. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). When testing with curl, URL-encode the `+` as `%2B` in query parameters. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API enforces rate limits. Implement exponential backoff in your client code. Wait at least 1 second between consecutive requests during testing. For production, use a queue or job scheduler to distribute lookups over time. Check your [Telnyx Portal](https://portal.telnyx.com) for current rate limit details. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection and that the Telnyx API is reachable. Check if your firewall or proxy blocks outbound HTTPS connections to `api.telnyx.com`. Temporarily disable VPN or proxy to test. If the issue persists, check the [Telnyx Status Page](https://status.telnyx.com) for service incidents. |
| Maven Build Fails | `mvn clean install` fails with dependency resolution errors. | Ensure you have Maven 3.6+ installed (`mvn --version`). Clear the local Maven cache: `rm -rf ~/.m2/repository`. Verify your internet connection. If using a corporate proxy, configure Maven settings in `~/.m2/settings.xml` with proxy credentials. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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

- [Send a Single SMS with Java and Spring](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/send-single-sms).
- [Receive SMS Webhooks with Java and Spring](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/receive-sms-webhook).
- [Implement Two-Factor Authentication with Java and Spring](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/java/otp-2fa).
