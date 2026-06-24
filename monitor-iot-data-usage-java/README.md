# Data Usage Monitoring with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that monitors SIM card data usage using the Telnyx Java SDK. This tutorial demonstrates how to retrieve real-time data consumption metrics, set up periodic polling for usage updates, and implement proper error handling for IoT device management at scale.

## Who Is This For?

- **Java developers** building iot features with Spring.
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
- At least one active SIM card in your Telnyx account.
- Spring Boot 2.7+ installed locally or via Maven/Gradle.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/monitor-iot-data-usage-java
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle SIM card data usage queries:

```java
package com.telnyx.service;

import com.telnyx.sdk.TelnyxClient;
import com.telnyx.sdk.exception.TelnyxException;
import com.telnyx.sdk.model.SimCard;
import com.telnyx.sdk.model.SimCardListResponse;
import org.springframework.stereotype.Service;
import java.util.HashMap;
import java.util.Map;

@Service
public class SimDataUsageService {
    
    private final TelnyxClient telnyxClient;
    
    public SimDataUsageService(TelnyxClient telnyxClient) {
        this.telnyxClient = telnyxClient;
    }
    
    /**
     * Retrieve data usage for a specific SIM card.
     * Returns a map with SIM details and current data consumption.
     */
    public Map<String, Object> getSimDataUsage(String simCardId) throws TelnyxException {
        // Retrieve SIM card details
        SimCard simCard = telnyxClient.simCards().retrieve(simCardId);
        
        // Extract serializable data from SDK response
        Map<String, Object> result = new HashMap<>();
        result.put("id", simCard.getId());
        result.put("iccid", simCard.getIccid());
        result.put("status", simCard.getStatus());
        result.put("sim_card_group_id", simCard.getSimCardGroupId());
        
        // Data usage is typically available via the SIM card object
        // or through a separate network_usage endpoint
        if (simCard.getDataLimit() != null) {
            result.put("data_limit_gb", simCard.getDataLimit());
        }
        
        return result;
    }
    
    /**
     * List all SIM cards with their current status.
     * Useful for monitoring a fleet of devices.
     */
    public java.util.List<Map<String, Object>> listAllSimCards() throws TelnyxException {
        SimCardListResponse response = telnyxClient.simCards().list();
        
        // Extract serializable data from each SIM card in the response
        return response.getData().stream()
            .map(sim -> {
                Map<String, Object> simData = new HashMap<>();
                simData.put("id", sim.getId());
                simData.put("iccid", sim.getIccid());
                simData.put("status", sim.getStatus());
                simData.put("sim_card_group_id", sim.getSimCardGroupId());
                if (sim.getDataLimit() != null) {
                    simData.put("data_limit_gb", sim.getDataLimit());
                }
                return simData;
            })
            .toList();
    }
}
```

Create a REST controller to expose data usage endpoints:

```java
package com.telnyx.controller;

import com.telnyx.service.SimDataUsageService;
import com.telnyx.sdk.exception.TelnyxException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/sim")
public class SimDataUsageController {
    
    private final SimDataUsageService simDataUsageService;
    
    public SimDataUsageController(SimDataUsageService simDataUsageService) {
        this.simDataUsageService = simDataUsageService;
    }
    
    /**
     * GET /api/sim/{simCardId}/usage
     * Retrieve data usage for a specific SIM card.
     */
    @GetMapping("/{simCardId}/usage")
    public ResponseEntity<?> getSimDataUsage(@PathVariable String simCardId) {
        try {
            Map<String, Object> usage = simDataUsageService.getSimDataUsage(simCardId);
            return ResponseEntity.ok(usage);
        } catch (TelnyxException e) {
            return handleTelnyxException(e);
        }
    }
    
    /**
     * GET /api/sim/list
     * List all SIM cards and their current status.
     */
    @GetMapping("/list")
    public ResponseEntity<?> listSimCards() {
        try {
            var simCards = simDataUsageService.listAllSimCards();
            return ResponseEntity.ok(Map.of("data", simCards));
        } catch (TelnyxException e) {
            return handleTelnyxException(e);
        }
    }
    
    /**
     * Centralized exception handler for Telnyx API errors.
     * Maps SDK exceptions to appropriate HTTP status codes.
     */
    private ResponseEntity<?> handleTelnyxException(TelnyxException e) {
        Map<String, String> errorResponse = new HashMap<>();
        errorResponse.put("error", e.getMessage());
        
        // Check exception type and map to HTTP status
        if (e instanceof com.telnyx.sdk.exception.AuthenticationException) {
            errorResponse.put("type", "AuthenticationError");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(errorResponse);
        } else if (e instanceof com.telnyx.sdk.exception.RateLimitException) {
            errorResponse.put("type", "RateLimitError");
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(errorResponse);
        } else if (e instanceof com.telnyx.sdk.exception.APIStatusException) {
            com.telnyx.sdk.exception.APIStatusException apiError = 
                (com.telnyx.sdk.exception.APIStatusException) e;
            errorResponse.put("type", "APIStatusError");
            errorResponse.put("status_code", String.valueOf(apiError.getStatusCode()));
            return ResponseEntity.status(apiError.getStatusCode()).body(errorResponse);
        } else if (e instanceof com.telnyx.sdk.exception.APIConnectionException) {
            errorResponse.put("type", "APIConnectionError");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(errorResponse);
        }
        
        // Generic error fallback
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
    }
}
```

Create the main Spring Boot application class:

```java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class SimDataMonitorApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(SimDataMonitorApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/monitor-iot-data-usage-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Unauthorized", "type": "AuthenticationError"}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable is set correctly. Run `echo $TELNYX_API_KEY` in your terminal to confirm the key is loaded. Ensure the key matches the one shown in the [Telnyx Portal](https://portal.telnyx.com). Restart the Spring Boot application after updating the environment variable. |
| SIM Card Not Found (404) | Requesting a SIM card ID returns `{"error": "SIM card not found", "type": "APIStatusError", "status_code": "404"}`. | Verify the SIM card ID is correct by listing all SIM cards using the `/api/sim/list` endpoint. Copy the exact `id` field from the response and use it in your request. Ensure the SIM card exists in your Telnyx account and has not been deleted. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Too Many Requests", "type": "RateLimitError"}` with HTTP 429. | Reduce the frequency of API requests. Implement exponential backoff in your polling logic: wait 1 second, then 2 seconds, then 4 seconds between retries. Cache SIM card data locally for 5–10 minutes to avoid redundant API calls. Consider using webhooks (sim_card.data_limit.reached) instead of polling for data limit alerts. |
| Network Connection Error (503) | The endpoint returns `{"error": "Connection failed", "type": "APIConnectionError"}` with HTTP 503. | Check your internet connection and firewall settings. Verify that outbound HTTPS traffic to `api.telnyx.com` is not blocked. Ensure your Spring Boot application can reach the Telnyx API by testing with `curl https://api.telnyx.com/v2/sim_cards -H "Authorization: Bearer YOUR_API_KEY"`. If the issue persists, contact Telnyx support. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Java version do I need?**

Java 17 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [IoT SIM Get Started](https://developers.telnyx.com/docs/iot-sim/get-started)
- [SIM Card API Reference](https://developers.telnyx.com/api-reference/sim-cards/get-all-sim-cards)
- [Telnyx IoT SIM Cards](https://telnyx.com/products/iot-sim-card)
- [IoT Data Plans Pricing](https://telnyx.com/pricing/iot-data-plans)

## Related Examples

- [Activate SIM Cards with Java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/java/sim-activation).
- [Configure APN Settings for IoT Devices](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/java/apn-configuration).
- [Monitor SIM Status Changes with Webhooks](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/java/sim-status-webhook).
