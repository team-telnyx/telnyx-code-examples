# SMS Survey with Node.js and Express

## What Does This Example Do?

Build a production-ready SMS survey system using Node.js and Express that sends survey questions via SMS and collects responses through inbound webhooks. This tutorial demonstrates the Telnyx Node.js SDK client initialization, webhook handling for inbound messages, survey state management, and proper error handling for telecom APIs.

## Who Is This For?

- **Node.js developers** building sms features with Express.
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

- Node.js 14 or higher and npm.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for inbound and outbound SMS.
- A publicly accessible URL for webhook delivery (use ngrok for local development).
- Basic familiarity with Express.js and async/await patterns.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-survey-bot-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create helper functions to manage survey logic. Add this to `app.js` after the module exports:

```javascript
/**
 * Survey questions in sequence.
 * Each question has an id, text, and validation function.
 */
const SURVEY_QUESTIONS = [
  {
    id: "satisfaction",
    text: "On a scale of 1-5, how satisfied are you with our service? (Reply with 1-5)",
    validate: (response) => /^[1-5]$/.test(response.trim()),
  },
  {
    id: "likelihood",
    text: "How likely are you to recommend us? (Reply with 1-5)",
    validate: (response) => /^[1-5]$/.test(response.trim()),
  },
  {
    id: "feedback",
    text: "Any additional feedback? (Reply with your message or 'skip')",
    validate: (response) => response.trim().length > 0,
  },
];

/**
 * Start a new survey for a phone number.
 * Sends the first question and initializes survey state.
 */
async function startSurvey(toNumber) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  if (!fromNumber) {
    throw new Error("TELNYX_PHONE_NUMBER environment variable not set");
  }

  // Validate E.164 format
  if (!toNumber.startsWith("+")) {
    throw new Error(
      "Phone number must be in E.164 format (e.g., +15551234567)"
    );
  }

  // Initialize survey state for this number
  surveyState[toNumber] = {
    currentQuestionIndex: 0,
    responses: {},
    startedAt: new Date(),
  };

  const firstQuestion = SURVEY_QUESTIONS[0];

  // Send first question
  const response = await client.messages.send({
    from: fromNumber,
    to: toNumber,
    text: firstQuestion.text,
  });

  return {
    survey_id: toNumber,
    message_id: response.data.id,
    status: response.data.to[0]?.status || "queued",
    question: firstQuestion.id,
  };
}

/**
 * Process an inbound survey response.
 * Validates answer, stores it, and sends next question or completion message.
 */
async function processSurveyResponse(fromNumber, messageText) {
  const fromNumberFormatted = fromNumber.startsWith("+")
    ? fromNumber
    : `+${fromNumber}`;

  // Check if survey exists for this number
  if (!surveyState[fromNumberFormatted]) {
    return {
      status: "error",
      message: "No active survey found. Start a new survey first.",
    };
  }

  const state = surveyState[fromNumberFormatted];
  const currentQuestion = SURVEY_QUESTIONS[state.currentQuestionIndex];

  // Validate response
  if (!currentQuestion.validate(messageText)) {
    return {
      status: "invalid",
      message: `Invalid response for "${currentQuestion.id}". Please try again.`,
      question: currentQuestion.id,
    };
  }

  // Store response
  state.responses[currentQuestion.id] = messageText.trim();

  // Move to next question or complete survey
  state.currentQuestionIndex += 1;

  if (state.currentQuestionIndex >= SURVEY_QUESTIONS.length) {
    // Survey complete
    const completionMessage =
      "Thank you for completing the survey! Your responses have been recorded.";
    await client.messages.send({
      from: process.env.TELNYX_PHONE_NUMBER,
      to: fromNumberFormatted,
      text: completionMessage,
    });

    const completedSurvey = {
      survey_id: fromNumberFormatted,
      status: "completed",
      responses: state.responses,
      completedAt: new Date(),
    };

    // Clean up state
    delete surveyState[fromNumberFormatted];

    return completedSurvey;
  }

  // Send next question
  const nextQuestion = SURVEY_QUESTIONS[state.currentQuestionIndex];
  await client.messages.send({
    from: process.env.TELNYX_PHONE_NUMBER,
    to: fromNumberFormatted,
    text: nextQuestion.text,
  });

  return {
    status: "next_question",
    question: nextQuestion.id,
    responses_so_far: state.responses,
  };
}

/**
 * Get survey status for a phone number.
 */
function getSurveyStatus(phoneNumber) {
  const formattedNumber = phoneNumber.startsWith("+")
    ? phoneNumber
    : `+${phoneNumber}`;

  if (!surveyState[formattedNumber]) {
    return { status: "not_found", message: "No active survey for this number" };
  }

  const state = surveyState[formattedNumber];
  const currentQuestion = SURVEY_QUESTIONS[state.currentQuestionIndex];

  return {
    survey_id: formattedNumber,
    status: "in_progress",
    current_question: currentQuestion.id,
    responses_collected: Object.keys(state.responses).length,
    total_questions: SURVEY_QUESTIONS.length,
  };
}
```

Now add the Express routes to handle survey operations:

```javascript
/**
 * POST /survey/start
 * Start a new survey for a given phone number.
 */
app.post("/survey/start", async (req, res) => {
  const { to } = req.body;

  if (!to) {
    return res.status(400).json({ error: "Missing required field: 'to'" });
  }

  try {
    const result = await startSurvey(to);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res
        .status(429)
        .json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIError) {
      return res.status(error.status_code).json({
        error: error.message,
        status_code: error.status_code,
      });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res
        .status(503)
        .json({ error: "Network error connecting to Telnyx" });
    }
    return res.status(400).json({ error: error.message });
  }
});

/**
 * POST /webhooks/message
 * Receive inbound SMS messages and process survey responses.
 * Telnyx sends message.received events to this endpoint.
 */
app.post("/webhooks/message", async (req, res) => {
  const event = req.body;

  // Acknowledge receipt immediately (Telnyx expects 200 OK)
  res.status(200).json({ received: true });

  // Only process message.received events
  if (event.data?.event_type !== "message.received") {
    return;
  }

  const messageData = event.data;
  const fromNumber = messageData.from?.phone_number;
  const messageText = messageData.text;

  if (!fromNumber || !messageText) {
    console.error("Invalid webhook payload:", event);
    return;
  }

  try {
    const result = await processSurveyResponse(fromNumber, messageText);

    // Log result for monitoring
    console.log("Survey response processed:", {
      from: fromNumber,
      result,
    });
  } catch (error) {
    console.error("Error processing survey response:", {
      from: fromNumber,
      error: error.message,
    });
  }
});

/**
 * GET /survey/status/:phoneNumber
 * Get the current status of a survey.
 */
app.get("/survey/status/:phoneNumber", (req, res) => {
  const { phoneNumber } = req.params;

  try {
    const status = getSurveyStatus(phoneNumber);
    return res.status(200).json(status);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

/**
 * GET /survey/responses/:phoneNumber
 * Retrieve completed survey responses.
 */
app.get("/survey/responses/:phoneNumber", (req, res) => {
  const formattedNumber = req.params.phoneNumber.startsWith("+")
    ? req.params.phoneNumber
    : `+${req.params.phoneNumber}`;

  if (surveyState[formattedNumber]) {
    return res.status(200).json({
      status: "in_progress",
      message: "Survey is still in progress",
    });
  }

  // In production, retrieve from database
  return res.status(404).json({
    status: "not_found",
    message: "No completed survey found for this number",
  });
});

/**
 * Health check endpoint.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SMS Survey server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.WEBHOOK_URL}/webhooks/message`);
});
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-survey-bot-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Invalid API key"}` with HTTP 401. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. If the key was regenerated recently, update your environment file and restart the Node.js server. |
| Webhooks Not Received | Survey responses are not being processed; the `/webhooks/message` endpoint is never called. | Confirm your ngrok URL is correctly configured in the Telnyx Portal under Messaging > Messaging Profiles. Verify the webhook URL is set to `https://your-ngrok-url.ngrok.io/webhooks/message`. Check ngrok logs to see if requests are being forwarded. Ensure your firewall allows inbound traffic on port 3000. |
| Invalid Phone Number Format | You receive a 400 error stating "Phone number must be in E.164 format" when starting a survey. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your test curl command to use properly formatted numbers. |
| Survey State Lost After Restart | Survey responses are lost when the Node.js server restarts. | The in-memory `surveyState` object is cleared on restart. For production, replace it with a persistent database (PostgreSQL, MongoDB, Redis). Store survey state with timestamps and implement cleanup for abandoned surveys. |
| Rate Limit Errors (429) | The endpoint returns `{"error": "Rate limit exceeded. Please slow down."}` with HTTP 429. | Telnyx enforces rate limits on API calls. Implement exponential backoff retry logic and queue survey requests if sending to many numbers simultaneously. Consider using a job queue (Bull, RabbitMQ) for high-volume surveys. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Node.js version do I need?**

Node.js 18 or higher. Node.js 20 LTS is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Receive SMS Webhooks with Node.js](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/nodejs/receive-sms-webhook).
- [Send Bulk SMS Messages with Node.js](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/nodejs/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/nodejs/otp-2fa).
