// src/main/java/com/telnyx/ai/AiAssistantsApplication.java
package com.telnyx.ai;

import io.github.cdimascio.dotenv.Dotenv;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class AiAssistantsApplication {
    public static void main(String[] args) {
        Dotenv dotenv = Dotenv.load();
        SpringApplication.run(AiAssistantsApplication.class, args);
    }
}

// src/main/java/com/telnyx/ai/config/TelnyxConfig.java
package com.telnyx.ai.config;

import com.telnyx.TelnyxClient;
import com.telnyx.TelnyxOkHttpClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TelnyxConfig {
    @Bean
    public TelnyxClient telnyxClient() {
        return TelnyxOkHttpClient.fromEnv();
    }
}

// src/main/java/com/telnyx/ai/service/AiAssistantService.java
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

@Service
public class AiAssistantService {
    private final TelnyxClient telnyxClient;

    @Autowired
    public AiAssistantService(TelnyxClient telnyxClient) {
        this.telnyxClient = telnyxClient;
    }

    public List<Map<String, Object>> listAssistants() throws TelnyxException {
        AiAssistantList response = telnyxClient.aiAssistants().list();
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

// src/main/java/com/telnyx/ai/controller/AiAssistantController.java
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

@RestController
@RequestMapping("/api/ai/assistants")
public class AiAssistantController {
    private final AiAssistantService aiAssistantService;

    @Autowired
    public AiAssistantController(AiAssistantService aiAssistantService) {
        this.aiAssistantService = aiAssistantService;
    }

    @GetMapping
    public ResponseEntity<?> listAssistants() {
        try {
            List<Map<String, Object>> assistants = aiAssistantService.listAssistants();
            Map<String, Object> response = new HashMap<>();
            response.put("data", assistants);
            response.put("count", assistants.size());
            return ResponseEntity.ok(response);

        } catch (TelnyxException e) {
            return handleTelnyxException(e);
        }
    }

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
