// pom.xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.telnyx</groupId>
  <artifactId>sim-data-monitor</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>2.7.14</version>
    <relativePath/>
  </parent>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>com.telnyx</groupId>
      <artifactId>telnyx-java</artifactId>
      <version>2.0.0</version>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>

// src/main/resources/application.properties
spring.application.name=sim-data-monitor
server.port=8080
telnyx.api.key=${TELNYX_API_KEY}

// src/main/java/com/telnyx/config/TelnyxConfig.java
package com.telnyx.config;

import com.telnyx.sdk.TelnyxClient;
import com.telnyx.sdk.TelnyxOkHttpClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TelnyxConfig {
    
    @Bean
    public TelnyxClient telnyxClient() {
        return TelnyxOkHttpClient.fromEnv();
    }
}

// src/main/java/com/telnyx/service/SimDataUsageService.java
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
    
    public Map<String, Object> getSimDataUsage(String simCardId) throws TelnyxException {
        SimCard simCard = telnyxClient.simCards().retrieve(simCardId);
        
        Map<String, Object> result = new HashMap<>();
        result.put("id", simCard.getId());
        result.put("iccid", simCard.getIccid());
        result.put("status", simCard.getStatus());
        result.put("sim_card_group_id", simCard.getSimCardGroupId());
        
        if (simCard.getDataLimit() != null) {
            result.put("data_limit_gb", simCard.getDataLimit());
        }
        
        return result;
    }
    
    public java.util.List<Map<String, Object>> listAllSimCards() throws TelnyxException {
        SimCardListResponse response = telnyxClient.simCards().list();
        
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

// src/main/java/com/telnyx/controller/SimDataUsageController.java
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
    
    @GetMapping("/{simCardId}/usage")
    public ResponseEntity<?> getSimDataUsage(@PathVariable String simCardId) {
        try {
            Map<String, Object> usage = simDataUsageService.getSimDataUsage(simCardId);
            return ResponseEntity.ok(usage);
        } catch (TelnyxException e) {
            return handleTelnyxException(e);
        }
    }
    
    @GetMapping("/list")
    public ResponseEntity<?> listSimCards() {
        try {
            var simCards = simDataUsageService.listAllSimCards();
            return ResponseEntity.ok(Map.of("data", simCards));
        } catch (TelnyxException e) {
            return handleTelnyxException(e);
        }
    }
    
    private ResponseEntity<?> handleTelnyxException(TelnyxException e) {
        Map<String, String> errorResponse = new HashMap<>();
        errorResponse.put("error", e.getMessage());
        
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
        
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
    }
}

// src/main/java/com/telnyx/SimDataMonitorApplication.java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class SimDataMonitorApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(SimDataMonitorApplication.class, args);
    }
}
