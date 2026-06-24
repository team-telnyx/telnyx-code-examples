# SIP Registration with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that manages SIP connection registration with the Telnyx SIP Trunking API. This tutorial demonstrates credential-based SIP authentication, proper error handling for telecom APIs, and secure credential management via environment variables. You'll create a REST endpoint to register a SIP connection and retrieve its status.

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
- Maven 3.6+ or Gradle 7.0+.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A SIP endpoint (PBX, SBC, or softphone) ready to register.
- Basic familiarity with Spring Boot and REST APIs.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-registration-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle SIP connection registration logic:

```java
package com.telnyx.sip.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import com.telnyx.model.sip.SipConnection;
import com.telnyx.model.sip.SipConnectionCreateRequest;
import com.telnyx.model.sip.SipConnectionResponse;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class SipRegistrationService {

    private final TelnyxClient telnyxClient;

    public SipRegistrationService(TelnyxClient telnyxClient) {
        this.telnyxClient = telnyxClient;
    }

    /**
     * Register a new SIP connection with credential-based authentication.
     * Returns a map with connection details for JSON serialization.
     */
    public Map<String, Object> registerSipConnection(
            String connectionName,
            String username,
            String password,
            String sipEndpoint) {

        // Validate inputs to prevent API errors
        if (connectionName == null || connectionName.trim().isEmpty()) {
            throw new IllegalArgumentException("Connection name is required");
        }
        if (username == null || username.trim().isEmpty()) {
            throw new IllegalArgumentException("SIP username is required");
        }
        if (password == null || password.trim().isEmpty()) {
            throw new IllegalArgumentException("SIP password is required");
        }
        if (sipEndpoint == null || sipEndpoint.trim().isEmpty()) {
            throw new IllegalArgumentException("SIP endpoint is required");
        }

        // Create SIP connection request with credential authentication
        SipConnectionCreateRequest request = new SipConnectionCreateRequest()
                .setName(connectionName)
                .setUsername(username)
                .setPassword(password)
                .setSipEndpoint(sipEndpoint)
                .setAuthType("credential");

        // Call Telnyx API to create the connection
        SipConnectionResponse response = telnyxClient.sipConnections().create(request);

        // Extract serializable data — SDK objects are NOT JSON-serializable
        return extractConnectionData(response.getData());
    }

    /**
     * Retrieve an existing SIP connection by ID.
     * Returns a map with connection details for JSON serialization.
     */
    public Map<String, Object> getSipConnection(String connectionId) {
        if (connectionId == null || connectionId.trim().isEmpty()) {
            throw new IllegalArgumentException("Connection ID is required");
        }

        SipConnectionResponse response = telnyxClient.sipConnections().retrieve(connectionId);

        return extractConnectionData(response.getData());
    }

    /**
     * Extract connection data into a JSON-serializable map.
     * This prevents serialization errors when returning SDK objects.
     */
    private Map<String, Object> extractConnectionData(SipConnection connection) {
        Map<String, Object> data = new HashMap<>();
        data.put("id", connection.getId());
        data.put("name", connection.getName());
        data.put("username", connection.getUsername());
        data.put("sip_endpoint", connection.getSipEndpoint());
        data.put("auth_type", connection.getAuthType());
        data.put("created_at", connection.getCreatedAt());
        data.put("updated_at", connection.getUpdatedAt());
        return data;
    }
}
```

Create a REST controller to expose the SIP registration endpoints:

```java
package com.telnyx.sip.controller;

import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import com.telnyx.sip.service.SipRegistrationService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/sip")
public class SipRegistrationController {

    private final SipRegistrationService sipRegistrationService;

    public SipRegistrationController(SipRegistrationService sipRegistrationService) {
        this.sipRegistrationService = sipRegistrationService;
    }

    /**
     * POST /api/sip/register
     * Register a new SIP connection with credential-based authentication.
     */
    @PostMapping("/register")
    public ResponseEntity<?> registerSipConnection(@RequestBody SipRegistrationRequest request) {
        // Validate request body
        if (request == null) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Request body required"));
        }

        if (request.getConnectionName() == null || request.getConnectionName().trim().isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing required field: 'connectionName'"));
        }

        if (request.getUsername() == null || request.getUsername().trim().isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing required field: 'username'"));
        }

        if (request.getPassword() == null || request.getPassword().trim().isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing required field: 'password'"));
        }

        if (request.getSipEndpoint() == null || request.getSipEndpoint().trim().isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing required field: 'sipEndpoint'"));
        }

        try {
            Map<String, Object> result = sipRegistrationService.registerSipConnection(
                    request.getConnectionName(),
                    request.getUsername(),
                    request.getPassword(),
                    request.getSipEndpoint()
            );
            return ResponseEntity.status(HttpStatus.CREATED).body(result);

        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Invalid API key"));

        } catch (RateLimitException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Rate limit exceeded. Please slow down."));

        } catch (TelnyxException e) {
            // Handle other Telnyx API errors
            int statusCode = e.getStatusCode() != null ? e.getStatusCode() : 500;
            return ResponseEntity.status(statusCode)
                    .body(Map.of("error", e.getMessage(), "status_code", statusCode));

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * GET /api/sip/connections/{connectionId}
     * Retrieve an existing SIP connection by ID.
     */
    @GetMapping("/connections/{connectionId}")
    public ResponseEntity<?> getSipConnection(@PathVariable String connectionId) {
        if (connectionId == null || connectionId.trim().isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Connection ID is required"));
        }

        try {
            Map<String, Object> result = sipRegistrationService.getSipConnection(connectionId);
            return ResponseEntity.ok(result);

        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Invalid API key"));

        } catch (RateLimitException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Rate limit exceeded. Please slow down."));

        } catch (TelnyxException e) {
            int statusCode = e.getStatusCode() != null ? e.getStatusCode() : 500;
            return ResponseEntity.status(statusCode)
                    .body(Map.of("error", e.getMessage(), "status_code", statusCode));

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Request DTO for SIP registration.
     */
    public static class SipRegistrationRequest {
        private String connectionName;
        private String username;
        private String password;
        private String sipEndpoint;

        // Getters and setters
        public String getConnectionName() {
            return connectionName;
        }

        public void setConnectionName(String connectionName) {
            this.connectionName = connectionName;
        }

        public String getUsername() {
            return username;
        }

        public void setUsername(String username) {
            this.username = username;
        }

        public String getPassword() {
            return password;
        }

        public void setPassword(String password) {
            this.password = password;
        }

        public String getSipEndpoint() {
            return sipEndpoint;
        }

        public void setSipEndpoint(String sipEndpoint) {
            this.sipEndpoint = sipEndpoint;
        }
    }
}
```

Create the main Spring Boot application class:

```java
package com.telnyx.sip;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class SipRegistrationApplication {

    public static void main(String[] args) {
        SpringApplication.run(SipRegistrationApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-registration-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Spring Boot application. |
| Missing Required Fields | You receive a 400 error stating "Missing required field" when calling `/api/sip/register`. | Ensure your JSON request body includes all four required fields: `connectionName`, `username`, `password`, and `sipEndpoint`. Verify the field names match exactly (case-sensitive). Example: `{"connectionName": "My SIP Trunk", "username": "user", "password": "pass", "sipEndpoint": "sip.example.com:5060"}`. |
| Environment Variable Not Set | The application fails to initialize the Telnyx client with an error about missing `TELNYX_API_KEY`. | Confirm your `.env` file exists in the project root directory (same level as `pom.xml`) and contains the variable. Ensure the file is named exactly `.env` (not `.env.txt` or `env`). The `Dotenv.load()` call in `TelnyxConfig` must execute before the bean is created—verify this configuration class is scanned by Spring. Restart the application after updating the `.env` file. |
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | You have exceeded the Telnyx API rate limit. Wait a few seconds before retrying the request. Implement exponential backoff in production: catch `RateLimitException` and retry after a delay. Check the [Telnyx API documentation](https://developers.telnyx.com) for current rate limits. |
| Connection Not Found (404) | Retrieving a connection by ID returns a 404 error. | Verify the `connectionId` path parameter is correct and matches an existing SIP connection. Use the ID returned from the `/api/sip/register` endpoint. Check that the connection was successfully created before attempting to retrieve it. |

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

- [Set Up SIP Trunking with Outbound Calls](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/java/outbound-sip-call).
- [Configure Inbound SIP Routing](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/java/inbound-sip-routing).
- [Implement SIP Failover and Load Balancing](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sip/java/failover-routing).
