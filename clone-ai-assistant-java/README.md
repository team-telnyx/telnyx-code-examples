# Clone AI Assistant with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot REST endpoint that clones an existing AI Assistant using the Telnyx Java SDK. This tutorial demonstrates how to retrieve an assistant, clone it with optional parameter overrides, and return properly serialized JSON responses. You'll learn the idiomatic Spring patterns for error handling, dependency injection, and secure credential management.

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
- An existing AI Assistant ID to clone (create one first using the [Create AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/java/create-ai-assistant) tutorial if needed).
- Spring Boot 2.7+ or 3.0+.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/clone-ai-assistant-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a service class to handle the cloning logic:

```java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.model.AiAssistant;
import com.telnyx.model.CloneAssistantRequest;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
public class AiAssistantService {

    private final TelnyxClient telnyxClient;

    public AiAssistantService(TelnyxClient telnyxClient) {
        this.telnyxClient = telnyxClient;
    }

    /**
     * Clone an existing AI Assistant with optional parameter overrides.
     * Returns a Map with the cloned assistant's details.
     */
    public Map<String, Object> cloneAssistant(String assistantId, Map<String, Object> overrides) {
        // Retrieve the original assistant to validate it exists
        AiAssistant original = telnyxClient.aiAssistants().retrieve(assistantId).getData();

        // Build clone request with optional overrides
        CloneAssistantRequest.Builder requestBuilder = CloneAssistantRequest.builder()
                .name(overrides.getOrDefault("name", original.getName()).toString());

        // Apply optional overrides if provided
        if (overrides.containsKey("instructions")) {
            requestBuilder.instructions(overrides.get("instructions").toString());
        }
        if (overrides.containsKey("model")) {
            requestBuilder.model(overrides.get("model").toString());
        }

        // Execute clone operation
        AiAssistant cloned = telnyxClient.aiAssistants()
                .clone(assistantId, requestBuilder.build())
                .getData();

        // Extract and return serializable response
        return extractAssistantData(cloned);
    }

    /**
     * Extract assistant fields into a JSON-serializable Map.
     * SDK objects are NOT JSON-serializable — always unpack to plain dicts.
     */
    private Map<String, Object> extractAssistantData(AiAssistant assistant) {
        Map<String, Object> result = new HashMap<>();
        result.put("id", assistant.getId());
        result.put("name", assistant.getName());
        result.put("model", assistant.getModel());
        result.put("instructions", assistant.getInstructions());
        result.put("enabled_features", assistant.getEnabledFeatures());
        result.put("created_at", assistant.getCreatedAt());
        return result;
    }
}
```

Create a REST controller to expose the cloning endpoint:

```java
package com.telnyx.controller;

import com.telnyx.service.AiAssistantService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/assistants")
public class AiAssistantController {

    private final AiAssistantService aiAssistantService;

    public AiAssistantController(AiAssistantService aiAssistantService) {
        this.aiAssistantService = aiAssistantService;
    }

    /**
     * POST /api/assistants/{assistantId}/clone
     * Clone an existing AI Assistant with optional parameter overrides.
     */
    @PostMapping("/{assistantId}/clone")
    public ResponseEntity<Map<String, Object>> cloneAssistant(
            @PathVariable String assistantId,
            @RequestBody(required = false) Map<String, Object> overrides) {

        if (assistantId == null || assistantId.isBlank()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Assistant ID is required"));
        }

        // Use empty map if no overrides provided
        if (overrides == null) {
            overrides = new HashMap<>();
        }

        try {
            Map<String, Object> clonedAssistant = aiAssistantService.cloneAssistant(assistantId, overrides);
            return ResponseEntity.status(HttpStatus.CREATED).body(clonedAssistant);

        } catch (com.telnyx.AuthenticationError e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Invalid API key"));

        } catch (com.telnyx.RateLimitError e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Rate limit exceeded. Please slow down."));

        } catch (com.telnyx.APIStatusError e) {
            return ResponseEntity.status(e.getStatusCode())
                    .body(Map.of("error", e.getMessage(), "status_code", e.getStatusCode()));

        } catch (com.telnyx.APIConnectionError e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", "Network error connecting to Telnyx"));

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", e.getMessage()));

        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Internal server error: " + e.getMessage()));
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
public class AiAssistantClonerApplication {

    public static void main(String[] args) {
        SpringApplication.run(AiAssistantClonerApplication.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/clone-ai-assistant-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable is set correctly before starting the Spring Boot application. Run `echo $TELNYX_API_KEY` to confirm the value. If the key was regenerated in the [Telnyx Portal](https://portal.telnyx.com), update your environment variable and restart the application with `mvn spring-boot:run`. |
| Assistant Not Found (404) | The endpoint returns `{"error": "Assistant not found", "status_code": 404}`. | Confirm the `assistantId` in your curl request matches an existing assistant in your Telnyx account. Retrieve your assistant IDs using the [List AI Assistants](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/java/list-ai-assistants) endpoint. Ensure you are using the correct assistant ID format (typically a UUID). |
| Rate Limit Error (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API enforces rate limits. Implement exponential backoff in your client code and retry after a delay. For production systems, consider caching cloned assistants and batching requests. Check the [Telnyx API documentation](https://developers.telnyx.com) for current rate limit thresholds. |
| Network Error (503) | The endpoint returns `{"error": "Network error connecting to Telnyx"}` with HTTP 503. | Verify your internet connection and that the Telnyx API is accessible. Check the [Telnyx Status Page](https://status.telnyx.com) for any ongoing incidents. Ensure your firewall or proxy does not block outbound HTTPS connections to `api.telnyx.com`. |
| Missing TELNYX_API_KEY | The application fails to start with an error about missing API key. | Set the environment variable before running the application: `export TELNYX_API_KEY=your_key_here` on Linux/macOS or `set TELNYX_API_KEY=your_key_here` on Windows. Alternatively, add it to your IDE's run configuration or a `.env` file loaded by Spring. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this AI example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

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

- [List AI Assistants](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/java/list-ai-assistants).
- [Get an AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/java/get-ai-assistant).
- [Chat with AI Assistant](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/ai/java/chat-with-ai-assistant).
