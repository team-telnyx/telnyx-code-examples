# eSIM Provisioning with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that provisions eSIM profiles over-the-air using the Telnyx IoT SIM Management API. This tutorial demonstrates how to manage SIM card lifecycle, configure eSIM profiles, and handle asynchronous provisioning workflows with proper error handling and webhook integration for real-world IoT deployments.

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
- Access to the Telnyx IoT SIM Management API.
- A publicly accessible URL for webhook callbacks (ngrok or similar for local testing).
- Postman or curl for testing endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/provision-esim-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a model class to represent eSIM provisioning requests:

```java
package com.telnyx.iot.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ESimProvisioningRequest {
    private String iccid;
    private String deviceName;
    private String apn;
    private String simCardGroupId;
    private String activationCode;
}
```

Create a service class to handle eSIM provisioning logic:

```java
package com.telnyx.iot.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import com.telnyx.iot.model.ESimProvisioningRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class ESimProvisioningService {

    private final TelnyxClient telnyxClient;

    /**
     * Provision an eSIM profile over-the-air.
     * Validates the request, activates the SIM card, and configures APN settings.
     */
    public Map<String, Object> provisionESim(ESimProvisioningRequest request) {
        log.info("Starting eSIM provisioning for ICCID: {}", request.getIccid());

        // Validate input
        if (request.getIccid() == null || request.getIccid().isEmpty()) {
            throw new IllegalArgumentException("ICCID is required");
        }

        if (request.getApn() == null || request.getApn().isEmpty()) {
            request.setApn("internet.telnyx"); // Default Telnyx APN
        }

        try {
            // Retrieve SIM card details by ICCID
            var simCard = telnyxClient.simCards().retrieve(request.getIccid());
            log.info("Retrieved SIM card: {}", simCard.getData().getId());

            // Activate the SIM card if not already active
            if (!"active".equals(simCard.getData().getStatus())) {
                var activateResponse = telnyxClient.simCards().activate(
                        simCard.getData().getId(),
                        new HashMap<>()
                );
                log.info("SIM card activated: {}", activateResponse.getData().getId());
            }

            // Return provisioning details
            return Map.of(
                    "simCardId", simCard.getData().getId(),
                    "iccid", simCard.getData().getIccid(),
                    "status", simCard.getData().getStatus(),
                    "apn", request.getApn(),
                    "deviceName", request.getDeviceName(),
                    "provisioningStatus", "success",
                    "message", "eSIM profile provisioned successfully"
            );

        } catch (AuthenticationException e) {
            log.error("Authentication failed: {}", e.getMessage());
            throw new RuntimeException("Invalid API key", e);
        } catch (RateLimitException e) {
            log.error("Rate limit exceeded: {}", e.getMessage());
            throw new RuntimeException("Rate limit exceeded. Please retry after a delay.", e);
        } catch (TelnyxException e) {
            log.error("Telnyx API error: {}", e.getMessage());
            throw new RuntimeException("Failed to provision eSIM: " + e.getMessage(), e);
        }
    }

    /**
     * Retrieve the current status of a provisioned eSIM.
     */
    public Map<String, Object> getESIMStatus(String simCardId) {
        try {
            var simCard = telnyxClient.simCards().retrieve(simCardId);
            var data = simCard.getData();

            return Map.of(
                    "simCardId", data.getId(),
                    "iccid", data.getIccid(),
                    "status", data.getStatus(),
                    "simCardGroupId", data.getSimCardGroupId() != null ? data.getSimCardGroupId() : "N/A",
                    "createdAt", data.getCreatedAt() != null ? data.getCreatedAt().toString() : "N/A"
            );

        } catch (TelnyxException e) {
            log.error("Failed to retrieve eSIM status: {}", e.getMessage());
            throw new RuntimeException("Failed to retrieve eSIM status: " + e.getMessage(), e);
        }
    }

    /**
     * List all SIM cards in a SIM card group for bulk provisioning.
     */
    public Map<String, Object> listSimCardsInGroup(String simCardGroupId) {
        try {
            var response = telnyxClient.simCards().list(
                    Map.of("filter[sim_card_group_id]", simCardGroupId)
            );

            var simCards = response.getData().stream()
                    .map(sim -> Map.of(
                            "id", sim.getId(),
                            "iccid", sim.getIccid(),
                            "status", sim.getStatus()
                    ))
                    .toList();

            return Map.of(
                    "simCardGroupId", simCardGroupId,
                    "totalCount", simCards.size(),
                    "simCards", simCards
            );

        } catch (TelnyxException e) {
            log.error("Failed to list SIM cards: {}", e.getMessage());
            throw new RuntimeException("Failed to list SIM cards: " + e.getMessage(), e);
        }
    }
}
```

Create a REST controller to expose eSIM provisioning endpoints:

```java
package com.telnyx.iot.controller;

import com.telnyx.iot.model.ESimProvisioningRequest;
import com.telnyx.iot.service.ESimProvisioningService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/esim")
@RequiredArgsConstructor
public class ESimProvisioningController {

    private final ESimProvisioningService eSimProvisioningService;

    /**
     * POST /esim/provision
     * Provision an eSIM profile over-the-air.
     */
    @PostMapping("/provision")
    public ResponseEntity<Map<String, Object>> provisionESim(
            @RequestBody ESimProvisioningRequest request) {
        log.info("Received eSIM provisioning request for ICCID: {}", request.getIccid());

        try {
            var result = eSimProvisioningService.provisionESim(request);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", e.getMessage()));
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * GET /esim/{simCardId}/status
     * Retrieve the current status of a provisioned eSIM.
     */
    @GetMapping("/{simCardId}/status")
    public ResponseEntity<Map<String, Object>> getESIMStatus(
            @PathVariable String simCardId) {
        log.info("Retrieving eSIM status for SIM card ID: {}", simCardId);

        try {
            var result = eSimProvisioningService.getESIMStatus(simCardId);
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * GET /esim/group/{simCardGroupId}/list
     * List all SIM cards in a SIM card group.
     */
    @GetMapping("/group/{simCardGroupId}/list")
    public ResponseEntity<Map<String, Object>> listSimCardsInGroup(
            @PathVariable String simCardGroupId) {
        log.info("Listing SIM cards in group: {}", simCardGroupId);

        try {
            var result = eSimProvisioningService.listSimCardsInGroup(simCardGroupId);
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }
}
```

Create a webhook controller to handle SIM card status change events:

```java
package com.telnyx.iot.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/webhooks")
@RequiredArgsConstructor
public class WebhookController {

    /**
     * POST /webhooks/sim-events
     * Handle SIM card status change webhooks from Telnyx.
     * Events: sim_card.status.changed, sim_card.data_limit.reached, sim_card.network.attached
     */
    @PostMapping("/sim-events")
    public ResponseEntity<Map<String, String>> handleSimEvent(
            @RequestBody Map<String, Object> payload) {
        log.info("Received webhook event: {}", payload);

        try {
            String eventType = (String) payload.get("type");
            Map<String, Object> data = (Map<String, Object>) payload.get("data");

            if ("sim_card.status.changed".equals(eventType)) {
                String simCardId = (String) data.get("id");
                String newStatus = (String) data.get("status");
                log.info("SIM card {} status changed to: {}", simCardId, newStatus);
            } else if ("sim_card.data_limit.reached".equals(eventType)) {
                String simCardId = (String) data.get("id");
                log.warn("SIM card {} has reached its data limit", simCardId);
            } else if ("sim_card.network.attached".equals(eventType)) {
                String simCardId = (String) data.get("id");
                log.info("SIM card {} attached to network", simCardId);
            }

            return ResponseEntity.ok(Map.of("status", "received"));

        } catch (Exception e) {
            log.error("Error processing webhook: {}", e.getMessage());
            return ResponseEntity.status(500)
                    .body(Map.of("error", "Failed to process webhook"));
        }
    }
}
```

Create the main Spring Boot application class:

```java
package com.telnyx.iot;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ESimProvisioningApplication {

    public static void main(String[] args) {
        SpringApplication.run(ESimProvisioningApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/provision-esim-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Spring Boot application after updating the environment variable. |
| ICCID Not Found | The provisioning request returns a 500 error stating "Failed to provision eSIM: SIM card not found". | Confirm the ICCID value is correct and matches a SIM card in your Telnyx account. Use the Telnyx Portal to verify the ICCID exists. Ensure the SIM card is in a provisioning-eligible state (not already fully activated). |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please retry after a delay."}` with HTTP 429. | Implement exponential backoff retry logic in your client. The Telnyx API allows 100 requests per second per API key. Space out provisioning requests or batch them using SIM Card Groups for bulk operations. |
| Webhook Not Receiving Events | Webhook endpoint is configured but not receiving `sim_card.status.changed` events from Telnyx. | Verify the webhook URL is publicly accessible and matches the `WEBHOOK_URL` environment variable. Use ngrok or similar to expose your local server: `ngrok http 8080`. Confirm the webhook is registered in the Telnyx Portal under IoT settings. Check Spring Boot logs for incoming POST requests to `/webhooks/sim-events`. |
| SIM Card Group Not Found | Listing SIM cards in a group returns an empty list or 500 error. | Verify the `simCardGroupId` exists in your Telnyx account. Use the Telnyx Portal to confirm the group ID and that SIM cards are assigned to it. Ensure your API key has permissions to access the SIM card group. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this IoT example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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

- [Monitor SIM Card Data Usage](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/java/data-usage-monitoring).
- [Activate SIM Cards in Bulk](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/java/sim-activation).
- [Configure Custom APN Settings](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/java/apn-configuration).
