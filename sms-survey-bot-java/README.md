# SMS Survey with Java and Spring

## What Does This Example Do?

Build a production-ready Spring Boot application that sends SMS survey questions and collects responses via inbound webhooks. This tutorial demonstrates the Telnyx Java SDK, webhook handling for inbound messages, survey state management, and secure credential management via environment variables.

## Who Is This For?

- **Java developers** building sms features with Spring.
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
- Maven 3.6 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for inbound and outbound SMS.
- A publicly accessible URL for webhook callbacks (ngrok or similar for local development).
- Spring Boot 2.7 or higher.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-survey-bot-java
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a Survey entity to track survey state `src/main/java/com/telnyx/model/Survey.java`:

```java
package com.telnyx.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.*;

@Entity
@Table(name = "surveys")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Survey {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String phoneNumber;
    private String currentQuestion;
    private Integer questionIndex;
    private String responses;
    private String status; // "pending", "in_progress", "completed"

    public Survey(String phoneNumber) {
        this.phoneNumber = phoneNumber;
        this.questionIndex = 0;
        this.responses = "";
        this.status = "pending";
    }
}
```

Create a repository `src/main/java/com/telnyx/repository/SurveyRepository.java`:

```java
package com.telnyx.repository;

import com.telnyx.model.Survey;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface SurveyRepository extends JpaRepository<Survey, Long> {
    Optional<Survey> findByPhoneNumber(String phoneNumber);
}
```

Create a service class `src/main/java/com/telnyx/service/SurveyService.java`:

```java
package com.telnyx.service;

import com.telnyx.model.Survey;
import com.telnyx.repository.SurveyRepository;
import com.telnyx.sdk.TelnyxClient;
import com.telnyx.sdk.model.MessageCreateResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;

@Service
public class SurveyService {

    private static final List<String> SURVEY_QUESTIONS = Arrays.asList(
        "How satisfied are you with our service? Reply 1-5.",
        "Would you recommend us to a friend? Reply YES or NO.",
        "What could we improve? Reply with your feedback."
    );

    @Autowired
    private TelnyxClient telnyxClient;

    @Autowired
    private SurveyRepository surveyRepository;

    @Value("${TELNYX_PHONE_NUMBER:+15551234567}")
    private String fromNumber;

    /**
     * Start a new survey for a phone number.
     * Sends the first question and creates a survey record.
     */
    public void startSurvey(String toNumber) throws Exception {
        // Validate E.164 format
        if (!toNumber.startsWith("+")) {
            throw new IllegalArgumentException("Phone number must be in E.164 format (e.g., +15551234567)");
        }

        // Check if survey already exists
        Optional<Survey> existing = surveyRepository.findByPhoneNumber(toNumber);
        if (existing.isPresent()) {
            throw new IllegalStateException("Survey already in progress for this number");
        }

        // Create survey record
        Survey survey = new Survey(toNumber);
        survey.setCurrentQuestion(SURVEY_QUESTIONS.get(0));
        survey.setQuestionIndex(0);
        survey.setStatus("in_progress");
        surveyRepository.save(survey);

        // Send first question via SMS
        sendSurveyQuestion(toNumber, SURVEY_QUESTIONS.get(0));
    }

    /**
     * Process inbound response and advance survey.
     */
    public void processResponse(String fromNumber, String responseText) throws Exception {
        Optional<Survey> surveyOpt = surveyRepository.findByPhoneNumber(fromNumber);
        if (!surveyOpt.isPresent()) {
            // No active survey; ignore response
            return;
        }

        Survey survey = surveyOpt.get();

        // Append response to survey responses
        if (!survey.getResponses().isEmpty()) {
            survey.setResponses(survey.getResponses() + " | ");
        }
        survey.setResponses(survey.getResponses() + responseText);

        // Move to next question
        int nextIndex = survey.getQuestionIndex() + 1;
        if (nextIndex < SURVEY_QUESTIONS.size()) {
            survey.setQuestionIndex(nextIndex);
            survey.setCurrentQuestion(SURVEY_QUESTIONS.get(nextIndex));
            surveyRepository.save(survey);
            sendSurveyQuestion(fromNumber, SURVEY_QUESTIONS.get(nextIndex));
        } else {
            // Survey complete
            survey.setStatus("completed");
            surveyRepository.save(survey);
            sendSurveyQuestion(fromNumber, "Thank you for completing the survey!");
        }
    }

    /**
     * Send a survey question via SMS.
     * Helper method — exceptions are caught in the controller.
     */
    private void sendSurveyQuestion(String toNumber, String questionText) throws Exception {
        telnyxClient.messages().create(
            com.telnyx.sdk.model.MessageCreateRequest.builder()
                .from(fromNumber)
                .to(toNumber)
                .text(questionText)
                .build()
        );
    }

    /**
     * Retrieve survey results by phone number.
     */
    public Optional<Survey> getSurveyResults(String phoneNumber) {
        return surveyRepository.findByPhoneNumber(phoneNumber);
    }
}
```

Create a REST controller `src/main/java/com/telnyx/controller/SurveyController.java`:

```java
package com.telnyx.controller;

import com.telnyx.model.Survey;
import com.telnyx.service.SurveyService;
import com.telnyx.sdk.exception.ApiException;
import com.telnyx.sdk.exception.AuthenticationException;
import com.telnyx.sdk.exception.RateLimitException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/survey")
public class SurveyController {

    @Autowired
    private SurveyService surveyService;

    /**
     * POST /api/survey/start
     * Start a new survey for a phone number.
     */
    @PostMapping("/start")
    public ResponseEntity<?> startSurvey(@RequestBody Map<String, String> request) {
        String toNumber = request.get("phone_number");

        if (toNumber == null || toNumber.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required field: 'phone_number'"));
        }

        try {
            surveyService.startSurvey(toNumber);
            return ResponseEntity.ok(Map.of(
                "message", "Survey started",
                "phone_number", toNumber
            ));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", e.getMessage()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of("error", e.getMessage()));
        } catch (AuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid API key"));
        } catch (RateLimitException e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(Map.of("error", "Rate limit exceeded. Please slow down."));
        } catch (ApiException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(Map.of("error", "Telnyx API error: " + e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Unexpected error: " + e.getMessage()));
        }
    }

    /**
     * POST /webhooks/sms
     * Webhook endpoint to receive inbound SMS messages.
     * Telnyx sends message.received events here.
     */
    @PostMapping("/webhooks/sms")
    public ResponseEntity<?> handleInboundSms(@RequestBody Map<String, Object> payload) {
        try {
            // Extract event type
            String eventType = (String) payload.get("type");
            if (!"message.received".equals(eventType)) {
                return ResponseEntity.ok(Map.of("status", "ignored"));
            }

            // Extract message data
            Map<String, Object> data = (Map<String, Object>) payload.get("data");
            if (data == null) {
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing data field"));
            }

            String fromNumber = (String) data.get("from");
            String messageText = (String) data.get("text");

            if (fromNumber == null || messageText == null) {
                return ResponseEntity.badRequest()
                    .body(Map.of("error", "Missing from or text field"));
            }

            // Process the response
            surveyService.processResponse(fromNumber, messageText);

            return ResponseEntity.ok(Map.of("status", "processed"));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Webhook processing error: " + e.getMessage()));
        }
    }

    /**
     * GET /api/survey/results/{phoneNumber}
     * Retrieve survey results for a phone number.
     */
    @GetMapping("/results/{phoneNumber}")
    public ResponseEntity<?> getSurveyResults(@PathVariable String phoneNumber) {
        Optional<Survey> survey = surveyService.getSurveyResults(phoneNumber);

        if (!survey.isPresent()) {
            return ResponseEntity.notFound().build();
        }

        Survey s = survey.get();
        return ResponseEntity.ok(Map.of(
            "id", s.getId(),
            "phone_number", s.getPhoneNumber(),
            "status", s.getStatus(),
            "responses", s.getResponses(),
            "current_question", s.getCurrentQuestion()
        ));
    }
}
```

Create the main Spring Boot application class `src/main/java/com/telnyx/Application.java`:

```java
package com.telnyx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

## Complete Code

See [`Application.java`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-survey-bot-java/Application.java) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` environment variable matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Set the environment variable before starting the Spring Boot application: `export TELNYX_API_KEY=your_key_here` on Linux/macOS or `set TELNYX_API_KEY=your_key_here` on Windows. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" or a Telnyx API error about invalid destination. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Webhook Not Receiving Messages | The `/api/survey/webhooks/sms` endpoint is not being called when inbound SMS arrives. | Configure your Messaging Profile in the [Telnyx Portal](https://portal.telnyx.com) to point to your webhook URL. For local development, use ngrok to expose your Spring Boot application: `ngrok http 8080`, then set the webhook URL to `https://your-ngrok-url.ngrok.io/api/survey/webhooks/sms`. Ensure the URL is publicly accessible and returns HTTP 200 for Telnyx to consider it successful. |
| Survey Already in Progress | Starting a survey returns `{"error": "Survey already in progress for this number"}` with HTTP 409. | A survey is already active for that phone number. Either complete the existing survey by sending responses, or delete the survey record from the database. For testing, you can clear the H2 database by restarting the application or accessing the H2 console at `http://localhost:8080/h2-console`. |
| Rate Limit Exceeded | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | You are sending too many requests to the Telnyx API. Implement exponential backoff in your client code or reduce the frequency of survey starts. Telnyx rate limits vary by plan; check your account limits in the Portal. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Java version do I need?**

Java 17 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Receive SMS Webhooks with Java](/tutorials/sms/java/receive-sms-
