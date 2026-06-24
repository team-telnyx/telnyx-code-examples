# List AI Assistants with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot REST endpoint that retrieves and lists all AI assistants from your Telnyx account. This tutorial demonstrates the Telnyx Java SDK initialization pattern, proper error handling for telecom APIs, secure credential management via environment variables, and JSON serialization of SDK response objects in a Spring context.

## Who Is This For?

- **Java developers** building ai features with Spring.
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
cd telnyx-code-examples/list-ai-assistants-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/list-ai-assistants-java
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a configuration class to initialize the Telnyx client as a Spring Bean:

```java
package com.telnyx.ai.config;

import com.telnyx.TelnyxClient;
import com.telnyx.TelnyxOkHttpClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Spring configuration for Telnyx SDK client initialization.
 * Loads API key from TELNYX_API_KEY environment variable.
 */
@Configuration
public class TelnyxConfig {

    @Bean
    public TelnyxClient telnyxClient() {
        // Initialize client using environment variable pattern
        return TelnyxOkHttpClient.fromEnv();
    }
}
```

Create a service class to handle AI assistant listing logic:

```java
package com.telnyx.ai.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.TelnyxException;
import com.telnyx.model.ai.AiAssistant;
import com.telnyx.model.ai.AiAssistantList;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Service for managing AI assistants via Telnyx API.
 * Handles retrieval and serialization of assistant data.
 */
@Service
public class AiAssistantService {

    private final TelnyxClient telnyxClient;

    @Autowired
    public AiAssistantService(TelnyxClient telnyxClient) {
        this.telnyxClient = telnyxClient;
    }

    /**
     * Retrieve all AI assistants from Telnyx account.
     * Returns a list of serializable assistant objects.
     *
     * @return List of assistant data as Maps (JSON-serializable).
     * @throws TelnyxException if API call fails.
     */
    public List<Map<String, Object>> listAssistants() throws TelnyxException {
        // Call Telnyx API to list assistants
        AiAssistantList response = telnyxClient.aiAssistants().list();

        // Extract and serialize assistant data — SDK objects are NOT JSON-serializable
        List<Map<String, Object>> assistants = new ArrayList<>();
        if (response.getData() != null) {
            for (AiAssistant assistant : response.getData()) {
                Map<String, Object> assistantMap = new HashMap<>();
                assistantMap.put("id", assistant.getId());
                assistantMap.put("name", assistant.getName());
                assistantMap.put("model", assistant.getModel());
                assistantMap.put("instructions", assistant.getInstructions());
                assistantMap.put("enabled_features", assistant.getEnabledFeatures());
                assistantMap.put("created_at", assistant.getCreatedAt());
                assistants.add(assistantMap);
            }
        }

        return assistants;
    }
}
```

Create a REST controller to expose the listing endpoint:

```java
package com.telnyx.ai.controller;

import com.telnyx.ai.service.AiAssistantService;
import com.telnyx.exception.TelnyxException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * REST controller for AI assistant endpoints.
 * Handles HTTP requests and error responses.
 */
@RestController
@RequestMapping("/api/ai/assistants")
public class AiAssistantController {

    private final AiAssistantService aiAssistantService;

    @Autowired
    public AiAssistantController(AiAssistantService aiAssistantService) {
        this.aiAssistantService = aiAssistantService;
    }

    /**
     * GET endpoint to list all AI assistants.
     * Returns a JSON array of assistant objects with pagination metadata.
     *
     * @return ResponseEntity with assistants list and HTTP 200, or error response.
     */
    @GetMapping
    public ResponseEntity<?> listAssistants() {
        try {
            List<Map<String, Object>> assistants = aiAssistantService.listAssistants();

            // Return assistants with metadata
            Map<String, Object> response = new HashMap<>();
            response.put("data", assistants);
            response.put("count", assistants.size());

            return ResponseEntity.ok(response);

        } catch (TelnyxException e) {
            // Handle Telnyx-specific exceptions with appropriate HTTP status codes
            return handleTelnyxException(e);
        }
    }

    /**
     * Map Telnyx exceptions to appropriate HTTP status codes.
     * Catches authentication, rate limit, and API errors.
     *
     * @param e The TelnyxException to handle.
     * @return ResponseEntity with error details and appropriate status code.
     */
    private ResponseEntity<?> handleTelnyxException(TelnyxException e) {
        Map<String, Object> errorResponse = new HashMap<>();

        if (e.getMessage().contains("Unauthorized") || e.getMessage().contains("401")) {
            errorResponse.put("error", "Invalid API key");
            errorResponse.put("details", e.getMessage());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(errorResponse);

        } else if (e.getMessage().contains("Rate limit") || e.getMessage().contains("429")) {
            errorResponse.put("error", "Rate limit exceeded. Please slow down.");
            errorResponse.put("details", e.getMessage());
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(errorResponse);

        } else if (e.getMessage().contains("Connection") || e.getMessage().contains("timeout")) {
            errorResponse.put("error", "Network error connecting to Telnyx");
            errorResponse.put("details", e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(errorResponse);

        } else {
            errorResponse.put("error", "API error");
            errorResponse.put("details", e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorResponse);
        }
    }
}
```

Create the main Spring Boot application class:

```java
package com.telnyx.ai;

import io.github.cdimascio.dotenv.Dotenv;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Main Spring Boot application entry point.
 * Loads environment variables from .env file before starting the application.
 */
@SpringBootApplication
public class AiAssistantsApplication {

    public static void main(String[] args) {
        // Load .env file into environment variables
        Dotenv dotenv = Dotenv.load();
        SpringApplication.run(AiAssistantsApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/list-ai-assistants-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401 status. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes around the key value. If the key was regenerated recently, update your `.env` file and restart the Spring Boot application with `mvn spring-boot:run`. |
| Empty Assistant List | The endpoint returns `{"data": [], "count": 0}` even though you have created assistants in the portal. | Confirm you are using the correct API key associated with the account where assistants were created. Log into the [Telnyx Portal](https://portal.telnyx.com) and verify assistants exist in your account. Check that the API key has permissions to list AI assistants. If using a restricted API key, ensure it includes the `ai:read` scope. |
| Connection Timeout | The application logs `Network error connecting to Telnyx` or the endpoint returns HTTP 503. | Verify your internet connection is active and can reach external APIs. Check if your firewall or proxy is blocking connections to `api.telnyx.com`. Ensure the Telnyx SDK version in `pom.xml` is up to date (2.0.0 or later). Restart the Spring Boot application and try again. If the issue persists, check the [Telnyx status page](https://status.telnyx.com) for service outages. |
| Maven Build Failure | Build fails with `Could not find artifact com.telnyx:telnyx-java` or similar dependency error. | Ensure your `pom.xml` has the correct Telnyx SDK dependency version. Run `mvn clean install` to refresh the local Maven repository. Verify you have internet connectivity to download dependencies from Maven Central. If behind a corporate proxy, configure Maven settings in `~/.m2/settings.xml` with proxy credentials. |
| Spring Boot Application Won't Start | Application fails to start with `No bean of type 'com.telnyx.TelnyxClient' found` or similar autowiring error. | Verify the `TelnyxConfig` class is in a package under `com.telnyx.ai` so Spring's component scanning finds it. Ensure the `@Configuration` annotation is present on the `TelnyxConfig` class. Check that the `@SpringBootApplication` annotation is on the main application class and is in the root package (`com.telnyx.ai`). Restart the application after making changes. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this AI example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What Java version do I need?**

Java 17 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [AI Assistants Guide](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant)
- [Assistants API Reference](https://developers.telnyx.com/api-reference/assistants/create-an-assistant)
- [Telnyx AI Assistants](https://telnyx.com/ai-assistants)
- [Voice AI Agents](https://telnyx.com/products/voice-ai-agents)

## Related Examples

- [Get an AI Assistant](/tutorials/ai/java/get-ai-assistant).
- [Create an AI Assistant](/tutorials/ai/java/create-ai-assistant).
- [Chat with an AI Assistant](/tutorials/ai/java/chat-with-ai-assistant).
