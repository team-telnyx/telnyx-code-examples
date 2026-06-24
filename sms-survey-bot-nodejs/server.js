#!/usr/bin/env node
/**
 * Production-ready SMS Survey system using Telnyx and Express.
 * Sends survey questions via SMS and collects responses through webhooks.
 */

const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();

// Middleware
app.use(bodyParser.json());

// Initialize Telnyx client with the new SDK pattern
const client = new Telnyx({
  apiKey: process.env.TELNYX_API_KEY,
});

// In-memory survey state (use a database in production)
const surveyState = {};

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
