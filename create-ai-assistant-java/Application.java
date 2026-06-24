// src/main/java/com/telnyx/AiAssistantApplication.java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class AiAssistantApplication {
    public static void main(String[] args) {
        SpringApplication.run(AiAssistantApplication.class, args);
    }
}

// src/main/java/com/telnyx/config/TelnyxConfig.java
package com.telnyx.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "telnyx")
public class TelnyxConfig {
    private String apiKey;
    private String defaultModel;

    public String getApiKey() {
        return apiKey;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
    }

    public String getDefaultModel() {
        return defaultModel;
    }

    public void setDefaultModel(String defaultModel) {
        this.defaultModel = defaultModel;
    }
}

// src/main/java/com/telnyx/config/TelnyxClientConfig.java
package com.telnyx.config;

import com.telnyx.TelnyxClient;
import com.telnyx.TelnyxOkHttpClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TelnyxClientConfig {

    @Bean
    public TelnyxClient telnyxClient(TelnyxConfig telnyxConfig) {
        return TelnyxOkHttpClient.fromEnv();
    }
}

// src/main/java/com/telnyx/dto/CreateAssistantRequest.java
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

// src/main/java/com/telnyx/dto/AssistantResponse.java
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

// src/main/java/com/telnyx/service/AiAssistantService.java
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

        // Call the Telnyx API using client.aiAssistants().create()
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

// src/main/java/com/telnyx/controller/AiAssistantController.java
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

// src/main/java/com/telnyx/exception/GlobalExceptionHandler.java
package com.telnyx.exception;

import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

import java.util.HashMap;
import java.util.Map;

@ControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<Map<String, String>> handleAuthenticationError(AuthenticationException e) {
        Map<String, String> error = new HashMap<>();
        error.put("error", "Invalid API key");
        error.put("details", e.getMessage());
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error);
    }

    @ExceptionHandler(RateLimitException.class)
    public ResponseEntity<Map<String, String>> handleRateLimitError(RateLimitException e) {
        Map<String, String> error = new HashMap<>();
        error.put("error", "Rate limit exceeded. Please slow down.");
        error.put("details", e.getMessage());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(error);
    }

    @ExceptionHandler(TelnyxException.class)
    public ResponseEntity<Map<String, String>> handleTelnyxError(TelnyxException e) {
        Map<String, String> error = new HashMap<>();
        error.put("error", "Telnyx API error");
        error.put("details", e.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> handleValidationError(IllegalArgumentException e) {
        Map<String, String> error = new HashMap<>();
        error.put("error", "Validation error");
        error.put("details", e.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleGenericError(Exception e) {
        Map<String, String> error = new HashMap<>();
        error.put("error", "Internal server error");
        error.put("details", e.getMessage());
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
    }
}

// src/main/resources/application.yml
spring:
  application:
    name: ai-assistant-service
  profiles:
    active: dev

telnyx:
  api-key: ${TELNYX_API_KEY}
  default-model: meta-llama/Meta-Llama-3.1-70B-Instruct
