# Create AI Assistant with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot endpoint that creates AI assistants using the Telnyx Java SDK. This tutorial demonstrates proper client initialization, request validation, comprehensive error handling for telecom APIs, and secure credential management via environment variables. You'll learn how to configure an AI assistant with custom instructions and enabled features for voice and messaging capabilities.

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
- Basic familiarity with Spring Boot REST controllers and dependency injection.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/create-ai-assistant-java
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a request DTO to handle incoming JSON payloads:

```java
package com.telnyx.dto;

import java.util.List;

public class CreateAssistantRequest {
    private String name;
    private String instructions;
    private String model;
    private List<String> enabledFeatures;

    public CreateAssistantRequest() {}

    public CreateAssistantRequest(String name, String instructions, String model, List<String> enabledFeatures) {
        this.name = name;
        this.instructions = instructions;
        this.model = model;
        this.enabledFeatures = enabledFeatures;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getInstructions() {
        return instructions;
    }

    public void setInstructions(String instructions) {
        this.instructions = instructions;
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public List<String> getEnabledFeatures() {
        return enabledFeatures;
    }

    public void setEnabledFeatures(List<String> enabledFeatures) {
        this.enabledFeatures = enabledFeatures;
    }
}
```

Create a response DTO to serialize assistant data:

```java
package com.telnyx.dto;

import java.time.OffsetDateTime;
import java.util.List;

public class AssistantResponse {
    private String id;
    private String name;
    private String model;
    private String instructions;
    private List<String> enabledFeatures;
    private OffsetDateTime createdAt;

    public AssistantResponse(String id, String name, String model, String instructions, 
                            List<String> enabledFeatures, OffsetDateTime createdAt) {
        this.id = id;
        this.name = name;
        this.model = model;
        this.instructions = instructions;
        this.enabledFeatures = enabledFeatures;
        this.createdAt = createdAt;
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getModel() {
        return model;
    }

    public String getInstructions() {
        return instructions;
    }

    public List<String> getEnabledFeatures() {
        return enabledFeatures;
    }

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }
}
```

Create a service class to handle business logic:

```java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.config.TelnyxConfig;
import com.telnyx.dto.AssistantResponse;
import com.telnyx.dto.CreateAssistantRequest;
import com.telnyx.model.AiAssistant;
import com.telnyx.model.CreateAiAssistantRequest;
import org.springframework.stereotype.Service;

@Service
public class AiAssistantService {
    private final TelnyxClient telnyxClient;
    private final TelnyxConfig telnyxConfig;

    public AiAssistantService(TelnyxClient telnyxClient, TelnyxConfig telnyxConfig) {
        this.telnyxClient = telnyxClient;
        this.telnyxConfig = telnyxConfig;
    }

    /**
     * Create a new AI assistant with the provided configuration.
     * Validates required fields and uses the default model if not specified.
     */
    public AssistantResponse createAssistant(CreateAssistantRequest request) {
        // Validate required fields
        if (request.getName() == null || request.getName().trim().isEmpty()) {
            throw new IllegalArgumentException("Assistant name is required");
        }
        if (request.getInstructions() == null || request.getInstructions().trim().isEmpty()) {
            throw new IllegalArgumentException("Assistant instructions are required");
        }

        // Use provided model or fall back to default
        String model = request.getModel() != null ? request.getModel() : telnyxConfig.getDefaultModel();

        // Build the API request using the SDK pattern
        CreateAiAssistantRequest apiRequest = new CreateAiAssistantRequest()
                .name(request.getName())
                .instructions(request.getInstructions())
                .model(model);

        // Add enabled features if provided
        if (request.getEnabledFeatures() != null && !request.getEnabledFeatures().isEmpty()) {
            apiRequest.enabledFeatures(request.getEnabledFeatures());
        }

        // Call the Telnyx API using client.ai_assistants.create()
        com.telnyx.model.CreateAiAssistantResponse response = telnyxClient.aiAssistants().create(apiRequest);

        // Extract and return serializable response data
        AiAssistant assistant = response.getData();
        return new AssistantResponse(
                assistant.getId(),
                assistant.getName(),
                assistant.getModel(),
                assistant.getInstructions(),
                assistant.getEnabledFeatures(),
                assistant.getCreatedAt()
        );
    }
}
```

Create a REST controller to expose the endpoint:

```java
package com.telnyx.controller;

import com.telnyx.dto.AssistantResponse;
import com.telnyx.dto.CreateAssistantRequest;
import com.telnyx.service.AiAssistantService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/assistants")
public class AiAssistantController {
    private final AiAssistantService aiAssistantService;

    public AiAssistantController(AiAssistantService aiAssistantService) {
        this.aiAssistantService = aiAssistantService;
    }

    /**
     * POST /api/assistants
     * Create a new AI assistant with the provided configuration.
     */
    @PostMapping
    public ResponseEntity<AssistantResponse> createAssistant(@RequestBody CreateAssistantRequest request) {
        AssistantResponse response = aiAssistantService.createAssistant(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/create-ai-assistant-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable is set correctly. Run `echo $TELNYX_API_KEY` to confirm the value. Ensure there are no trailing spaces or quotes. If the key was regenerated in the [Telnyx Portal](https://portal.telnyx.com), update your environment variable and restart the Spring Boot application. |
| Missing Required Fields | You receive a 400 error stating "Assistant name is required" or "Assistant instructions are required". | Ensure your POST request JSON includes both `name` and `instructions` fields with non-empty string values. Example: `{"name": "My Bot", "instructions": "Be helpful", "enabledFeatures": ["telephony"]}`. Verify the Content-Type header is set to `application/json`. |
| Rate Limit Exceeded (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | The Telnyx API has rate limits. Implement exponential backoff in your client code or reduce the frequency of requests. Check the [Telnyx documentation](https://portal.telnyx.com) for current rate limit thresholds. Consider caching assistant configurations to avoid redundant API calls. |
| Model Not Found | The API returns an error about an invalid or unsupported model. | Verify the `model` parameter matches a supported LLM model ID. The default is `meta-llama/Meta-Llama-3.1-70B-Instruct`. Check the Telnyx AI Assistants documentation for the complete list of available models. If you omit the model field, the application uses the default from `application.yml`. |
| Spring Boot Application Won't Start | The application fails to start with a bean initialization error or property binding error. | Ensure `application.yml` is in `src/main/resources/` and properly formatted (YAML is whitespace-sensitive). Verify the `TELNYX_API_KEY` environment variable is exported before running `mvn spring-boot:run`. Check that all dependencies in `pom.xml` are correctly specified and Maven can download them. |

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

- [List AI Assistants](/tutorials/ai/java/list-ai-assistants).
- [Get an AI Assistant](/tutorials/ai/java/get-ai-assistant).
- [Chat with an AI Assistant](/tutorials/ai/java/chat-with-ai-assistant).
