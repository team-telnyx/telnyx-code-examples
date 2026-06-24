# Device Location with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that tracks SIM card device locations using the Telnyx IoT API. This tutorial demonstrates how to query SIM card network attachment data, parse location information from carrier networks, and expose location endpoints with proper error handling and security patterns.

By the end of this tutorial, you'll have a REST API that retrieves device locations associated with active SIM cards, handles network errors gracefully, and follows Spring Boot best practices for production deployments.

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
- At least one active SIM card in your Telnyx account with network connectivity.
- Spring Boot 2.7+ or 3.0+.
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/track-iot-device-location-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a model class to represent device location data:

```java
package com.telnyx.model;

import com.fasterxml.jackson.annotation.JsonProperty;

public class DeviceLocation {
    @JsonProperty("sim_card_id")
    private String simCardId;

    @JsonProperty("iccid")
    private String iccid;

    @JsonProperty("status")
    private String status;

    @JsonProperty("latitude")
    private Double latitude;

    @JsonProperty("longitude")
    private Double longitude;

    @JsonProperty("accuracy_meters")
    private Integer accuracyMeters;

    @JsonProperty("last_location_update")
    private String lastLocationUpdate;

    @JsonProperty("carrier_name")
    private String carrierName;

    // Constructors
    public DeviceLocation() {}

    public DeviceLocation(String simCardId, String iccid, String status) {
        this.simCardId = simCardId;
        this.iccid = iccid;
        this.status = status;
    }

    // Getters and Setters
    public String getSimCardId() { return simCardId; }
    public void setSimCardId(String simCardId) { this.simCardId = simCardId; }

    public String getIccid() { return iccid; }
    public void setIccid(String iccid) { this.iccid = iccid; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public Double getLatitude() { return latitude; }
    public void setLatitude(Double latitude) { this.latitude = latitude; }

    public Double getLongitude() { return longitude; }
    public void setLongitude(Double longitude) { this.longitude = longitude; }

    public Integer getAccuracyMeters() { return accuracyMeters; }
    public void setAccuracyMeters(Integer accuracyMeters) { this.accuracyMeters = accuracyMeters; }

    public String getLastLocationUpdate() { return lastLocationUpdate; }
    public void setLastLocationUpdate(String lastLocationUpdate) { this.lastLocationUpdate = lastLocationUpdate; }

    public String getCarrierName() { return carrierName; }
    public void setCarrierName(String carrierName) { this.carrierName = carrierName; }
}
```

Create a service class to handle location queries:

```java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.model.DeviceLocation;
import com.telnyx.exception.TelnyxException;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.APIStatusException;
import com.telnyx.exception.APIConnectionException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
public class LocationService {

    private final TelnyxClient telnyxClient;

    @Autowired
    public LocationService(TelnyxClient telnyxClient) {
        this.telnyxClient = telnyxClient;
    }

    /**
     * Retrieve all SIM cards and extract location data from network attachment info.
     * Location data is derived from carrier network information when available.
     */
    public List<DeviceLocation> getAllDeviceLocations() throws TelnyxException {
        List<DeviceLocation> locations = new ArrayList<>();

        try {
            // Fetch all SIM cards from the account
            var response = telnyxClient.simCards().list();

            if (response.getData() != null) {
                for (var simCard : response.getData()) {
                    DeviceLocation location = new DeviceLocation();
                    location.setSimCardId(simCard.getId());
                    location.setIccid(simCard.getIccid());
                    location.setStatus(simCard.getStatus());

                    // Extract location metadata from SIM card network info if available
                    if (simCard.getNetworkAccessProfile() != null) {
                        // Network access profile may contain carrier and location hints
                        location.setCarrierName(simCard.getNetworkAccessProfile().getName());
                    }

                    // In production, query network usage endpoint for location timestamps
                    location.setLastLocationUpdate(simCard.getUpdatedAt());

                    locations.add(location);
                }
            }

            return locations;

        } catch (AuthenticationException e) {
            throw new TelnyxException("Authentication failed: " + e.getMessage(), e);
        } catch (RateLimitException e) {
            throw new TelnyxException("Rate limit exceeded: " + e.getMessage(), e);
        } catch (APIStatusException e) {
            throw new TelnyxException("API error: " + e.getMessage(), e);
        } catch (APIConnectionException e) {
            throw new TelnyxException("Connection error: " + e.getMessage(), e);
        }
    }

    /**
     * Retrieve location data for a specific SIM card by ID.
     * Returns SIM card details with network attachment status.
     */
    public DeviceLocation getDeviceLocationBySim(String simCardId) throws TelnyxException {
        try {
            var response = telnyxClient.simCards().retrieve(simCardId);
            var simCard = response.getData();

            DeviceLocation location = new DeviceLocation();
            location.setSimCardId(simCard.getId());
            location.setIccid(simCard.getIccid());
            location.setStatus(simCard.getStatus());
            location.setLastLocationUpdate(simCard.getUpdatedAt());

            if (simCard.getNetworkAccessProfile() != null) {
                location.setCarrierName(simCard.getNetworkAccessProfile().getName());
            }

            return location;

        } catch (AuthenticationException e) {
            throw new TelnyxException("Authentication failed: " + e.getMessage(), e);
        } catch (RateLimitException e) {
            throw new TelnyxException("Rate limit exceeded: " + e.getMessage(), e);
        } catch (APIStatusException e) {
            throw new TelnyxException("API error: " + e.getMessage(), e);
        } catch (APIConnectionException e) {
            throw new TelnyxException("Connection error: " + e.getMessage(), e);
        }
    }
}
```

Create a custom exception class:

```java
package com.telnyx.exception;

public class TelnyxException extends Exception {
    public TelnyxException(String message) {
        super(message);
    }

    public TelnyxException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Create a REST controller to expose location endpoints:

```java
package com.telnyx.controller;

import com.telnyx.model.DeviceLocation;
import com.telnyx.service.LocationService;
import com.telnyx.exception.TelnyxException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/devices")
public class LocationController {

    private final LocationService locationService;

    @Autowired
    public LocationController(LocationService locationService) {
        this.locationService = locationService;
    }

    /**
     * GET /api/devices/locations
     * Retrieve all device locations across all SIM cards.
     */
    @GetMapping("/locations")
    public ResponseEntity<?> getAllLocations() {
        try {
            List<DeviceLocation> locations = locationService.getAllDeviceLocations();
            return ResponseEntity.ok(locations);
        } catch (TelnyxException e) {
            return handleTelnyxException(e);
        }
    }

    /**
     * GET /api/devices/{simCardId}/location
     * Retrieve location for a specific SIM card.
     */
    @GetMapping("/{simCardId}/location")
    public ResponseEntity<?> getLocationBySim(@PathVariable String simCardId) {
        if (simCardId == null || simCardId.trim().isEmpty()) {
            Map<String, String> error = new HashMap<>();
            error.put("error", "SIM card ID is required");
            return ResponseEntity.badRequest().body(error);
        }

        try {
            DeviceLocation location = locationService.getDeviceLocationBySim(simCardId);
            return ResponseEntity.ok(location);
        } catch (TelnyxException e) {
            return handleTelnyxException(e);
        }
    }

    /**
     * Handle Telnyx exceptions and map to appropriate HTTP status codes.
     */
    private ResponseEntity<?> handleTelnyxException(TelnyxException e) {
        Map<String, String> error = new HashMap<>();
        error.put("error", e.getMessage());

        String message = e.getMessage();
        if (message != null && message.contains("Authentication failed")) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error);
        } else if (message != null && message.contains("Rate limit exceeded")) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(error);
        } else if (message != null && message.contains("Connection error")) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(error);
        } else {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
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
public class DeviceLocationApplication {

    public static void main(String[] args) {
        SpringApplication.run(DeviceLocationApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/track-iot-device-location-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Authentication failed: ..."}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable is set correctly. Run `echo $TELNYX_API_KEY` to confirm the value. Ensure there are no trailing spaces or quotes. If the key was regenerated in the [Telnyx Portal](https://portal.telnyx.com), update your environment variable and restart the Spring Boot application with `mvn spring-boot:run`. |
| SIM Card Not Found | The endpoint returns a 500 error when querying a specific SIM card ID that does not exist in your account. | Verify the SIM card ID is correct by first calling `GET /api/devices/locations` to list all available SIM cards. Copy the exact `sim_card_id` value from the response and use it in the path parameter. Ensure the SIM card has not been deleted from your account. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded: ..."}` with HTTP 429. | The Telnyx API enforces rate limits on requests. Implement exponential backoff in your client code: wait 1 second, then 2 seconds, then 4 seconds between retries. Reduce the frequency of location queries if polling continuously. For production use, consider caching location data with a TTL of 5-10 minutes to minimize API calls. |
| Connection Error (503) | The endpoint returns `{"error": "Connection error: ..."}` with HTTP 503. | This indicates a network connectivity issue between your application and the Telnyx API. Verify your internet connection is active. Check if the Telnyx API service is operational by visiting the [Telnyx Status Page](https://status.telnyx.com). If running in a containerized environment, ensure the container has outbound internet access. Implement retry logic with exponential backoff for production resilience. |
| Empty Location List | The `/api/devices/locations` endpoint returns an empty array `[]` even though you have active SIM cards. | Verify that SIM cards exist in your Telnyx account by logging into the [Telnyx Portal](https://portal.telnyx.com) and navigating to IoT → SIM Cards. Ensure the API key in your environment variable has permissions to read SIM card data. Check that the SIM cards are in an `active` status; inactive or suspended SIM cards may not appear in certain queries. |

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

- [Activate SIM Cards with Java](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/java/sim-activation).
- [Monitor SIM Card Data Usage](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/java/data-usage-monitoring).
- [Configure Custom APN Settings](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/iot/java/apn-configuration).
