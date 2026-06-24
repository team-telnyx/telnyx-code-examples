// pom.xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.telnyx</groupId>
  <artifactId>sip-routing-app</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.1.0</version>
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
      <groupId>io.github.cdimascio</groupId>
      <artifactId>dotenv-java</artifactId>
      <version>3.0.0</version>
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

// src/main/java/com/telnyx/SipRoutingApplication.java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class SipRoutingApplication {
    public static void main(String[] args) {
        SpringApplication.run(SipRoutingApplication.class, args);
    }
}

// src/main/java/com/telnyx/config/TelnyxConfig.java
package com.telnyx.config;

import com.telnyx.TelnyxClient;
import com.telnyx.TelnyxOkHttpClient;
import io.github.cdimascio.dotenv.Dotenv;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TelnyxConfig {
    private static final Dotenv dotenv = Dotenv.load();
    
    @Bean
    public TelnyxClient telnyxClient() {
        return TelnyxOkHttpClient.fromEnv();
    }
    
    public static String getEnv(String key) {
        return dotenv.get(key);
    }
}

// src/main/java/com/telnyx/service/SipRoutingService.java
package com.telnyx.service;

import com.telnyx.TelnyxClient;
import com.telnyx.exception.AuthenticationException;
import com.telnyx.exception.RateLimitException;
import com.telnyx.exception.TelnyxException;
import com.telnyx.model.sip.SipConnection;
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
    
    public Map<String, Object> createSipConnection(String name, String sipAddress, int sipPort) {
        try {
            Map<String, Object> params = new HashMap<>();
            params.put("connection_name", name);
            params.put("inbound_address", sipAddress);
            params.put("inbound_port", sipPort);
            params.put("inbound_transport", "UDP");
            
            SipConnectionResponse response = telnyxClient.sipConnections().create(params);
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
    
    public List<Map<String, Object>> listSipConnections() {
        try {
            SipConnectionListResponse response = telnyxClient.sipConnections().list();
            
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
    
    public Map<String, Object> getSipConnection(String connectionId) {
        try {
            SipConnectionResponse response = telnyxClient.sipConnections().retrieve(connectionId);
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

// src/main/java/com/telnyx/controller/SipRoutingController.java
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
    
    @GetMapping("/connections")
    public ResponseEntity<?> listConnections() {
        try {
            List<Map<String, Object>> connections = sipRoutingService.listSipConnections();
            return ResponseEntity.ok(connections);
        } catch (RuntimeException e) {
            return handleException(e);
        }
    }
    
    @GetMapping("/connections/{id}")
    public ResponseEntity<?> getConnection(@PathVariable String id) {
        try {
            Map<String, Object> connection = sipRoutingService.getSipConnection(id);
            return ResponseEntity.ok(connection);
        } catch (RuntimeException e) {
            return handleException(e);
        }
    }
    
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

// .env
TELNYX_API_KEY=YOUR_API_KEY_HERE
TELNYX_PHONE_NUMBER=+15551234567
SIP_ENDPOINT=sip.example.com:5060
