# Inbound SIP Routing with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that manages inbound SIP routing using the Telnyx Java SDK. This tutorial demonstrates how to create SIP connections, configure inbound routing rules, and handle incoming calls through a REST API. You'll learn the new client initialization pattern, proper error handling for telecom APIs, and secure credential management via environment variables.

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
- A Telnyx phone number enabled for inbound voice calls.
- A publicly accessible SIP endpoint (PBX, SBC, or softphone) to receive inbound calls.
- curl or Postman for testing HTTP endpoints.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-java
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle SIP connection management:

```java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import com.telnyx.model.sip.SipConnection;
import com.telnyx.model.sip.SipConnectionCreateRequest;
import com.telnyx.model.sip.SipConnectionListResponse;
import com.telnyx.model.sip.SipConnectionResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class SipRoutingService {
    
    private final TelnyxClient telnyxClient;
    
    @Autowired
    public SipRoutingService(TelnyxClient telnyxClient) {
        this.telnyxClient = telnyxClient;
    }
    
    /**
     * Create a new SIP connection for inbound routing.
     * This connection defines where inbound calls should be routed.
     */
    public Map<String, Object> createSipConnection(String name, String sipAddress, int sipPort) {
        try {
            // Build SIP connection parameters
            Map<String, Object> params = new HashMap<>();
            params.put("connection_name", name);
            params.put("inbound_address", sipAddress);
            params.put("inbound_port", sipPort);
            params.put("inbound_transport", "UDP");
            
            // Create the connection via Telnyx API
            SipConnectionResponse response = telnyxClient.sipConnections().create(params);
            
            // Extract serializable data — SDK objects are NOT JSON-serializable
            SipConnection connection = response.getData();
            return Map.of(
                "id", connection.getId(),
                "name", connection.getConnectionName(),
                "inbound_address", connection.getInboundAddress(),
                "inbound_port", connection.getInboundPort(),
                "status", connection.getStatus()
            );
        } catch (AuthenticationException e) {
            throw new RuntimeException("Authentication failed: " + e.getMessage(), e);
        } catch (RateLimitException e) {
            throw new RuntimeException("Rate limit exceeded: " + e.getMessage(), e);
        } catch (TelnyxException e) {
            throw new RuntimeException("Telnyx API error: " + e.getMessage(), e);
        }
    }
    
    /**
     * List all SIP connections configured in your account.
     */
    public List<Map<String, Object>> listSipConnections() {
        try {
            SipConnectionListResponse response = telnyxClient.sipConnections().list();
            
            // Extract serializable data from each connection
            return response.getData().stream()
                .map(connection -> Map.of(
                    "id", connection.getId(),
                    "name", connection.getConnectionName(),
                    "inbound_address", connection.getInboundAddress(),
                    "inbound_port", connection.getInboundPort(),
                    "status", connection.getStatus()
                ))
                .collect(Collectors.toList());
        } catch (AuthenticationException e) {
            throw new RuntimeException("Authentication failed: " + e.getMessage(), e);
        } catch (RateLimitException e) {
            throw new RuntimeException("Rate limit exceeded: " + e.getMessage(), e);
        } catch (TelnyxException e) {
            throw new RuntimeException("Telnyx API error: " + e.getMessage(), e);
        }
    }
    
    /**
     * Retrieve details of a specific SIP connection.
     */
    public Map<String, Object> getSipConnection(String connectionId) {
        try {
            SipConnectionResponse response = telnyxClient.sipConnections().retrieve(connectionId);
            
            // Extract serializable data
            SipConnection connection = response.getData();
            return Map.of(
                "id", connection.getId(),
                "name", connection.getConnectionName(),
                "inbound_address", connection.getInboundAddress(),
                "inbound_port", connection.getInboundPort(),
                "status", connection.getStatus()
            );
        } catch (AuthenticationException e) {
            throw new RuntimeException("Authentication failed: " + e.getMessage(), e);
        } catch (RateLimitException e) {
            throw new RuntimeException("Rate limit exceeded: " + e.getMessage(), e);
        } catch (TelnyxException e) {
            throw new RuntimeException("Telnyx API error: " + e.getMessage(), e);
        }
    }
}
```

Create a REST controller to expose SIP routing endpoints:

```java
package com.telnyx.controller;

import com.telnyx.service.SipRoutingService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/sip")
public class SipRoutingController {
    
    private final SipRoutingService sipRoutingService;
    
    @Autowired
    public SipRoutingController(SipRoutingService sipRoutingService) {
        this.sipRoutingService = sipRoutingService;
    }
    
    /**
     * POST /api/sip/connections
     * Create a new SIP connection for inbound routing.
     */
    @PostMapping("/connections")
    public ResponseEntity<Map<String, Object>> createConnection(
            @RequestBody Map<String, Object> request) {
        
        String name = (String) request.get("name");
        String sipAddress = (String) request.get("sip_address");
        Integer sipPort = (Integer) request.get("sip_port");
        
        if (name == null || sipAddress == null || sipPort == null) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required fields: name, sip_address, sip_port"));
        }
        
        try {
            Map<String, Object> result = sipRoutingService.createSipConnection(name, sipAddress, sipPort);
            return ResponseEntity.status(HttpStatus.CREATED).body(result);
        } catch (RuntimeException e) {
            return handleException(e);
        }
    }
    
    /**
     * GET /api/sip/connections
     * List all SIP connections.
     */
    @GetMapping("/connections")
    public ResponseEntity<?> listConnections() {
        try {
            List<Map<String, Object>> connections = sipRoutingService.listSipConnections();
            return ResponseEntity.ok(connections);
        } catch (RuntimeException e) {
            return handleException(e);
        }
    }
    
    /**
     * GET /api/sip/connections/{id}
     * Retrieve a specific SIP connection.
     */
    @GetMapping("/connections/{id}")
    public ResponseEntity<?> getConnection(@PathVariable String id) {
        try {
            Map<String, Object> connection = sipRoutingService.getSipConnection(id);
            return ResponseEntity.ok(connection);
        } catch (RuntimeException e) {
            return handleException(e);
        }
    }
    
    /**
     * Handle exceptions and map to appropriate HTTP status codes.
     */
    private ResponseEntity<?> handleException(RuntimeException e) {
        String message = e.getMessage();
        
        if (message != null && message.contains("Authentication failed")) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } else if (message != null && message.contains("Rate limit exceeded")) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } else {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", message != null ? message : "Internal server error"));
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
public class SipRoutingApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(SipRoutingApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Spring Boot application. |
| SIP Connection Creation Fails | You receive a 500 error with "Telnyx API error" when creating a connection. | Verify that the `sip_address` is a valid IP address or hostname and `sip_port` is a valid port number (typically 5060 for SIP). Ensure your SIP endpoint is reachable and configured to accept inbound connections from Telnyx. Check the Telnyx Portal for any account restrictions or service limits. |
| Environment Variable Not Loaded | The application throws a `NullPointerException` or "Invalid API key" error on startup. | Confirm your `.env` file exists in the project root directory (same level as `pom.xml`). Ensure the file is named exactly `.env` (not `.env.txt` or `env`). Verify that `Dotenv.load()` is called in the `TelnyxConfig` class before the client is initialized. Restart the Spring Boot application after creating or modifying the `.env` file. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SIP example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

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

- [Configure SIP Authentication](/tutorials/sip/java/sip-authentication).
- [Set Up SIP Trunking](/tutorials/sip/java/sip-trunking-setup).
- [Implement Failover Routing](/tutorials/sip/java/failover-routing).
