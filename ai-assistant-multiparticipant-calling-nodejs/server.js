import "dotenv/config";
import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

const config = {
  telnyxApiKey: process.env.TELNYX_API_KEY,
  telnyxPublicKey: process.env.TELNYX_PUBLIC_KEY || "",
  connectionId: process.env.CONNECTION_ID,
  telnyxNumber: process.env.TELNYX_NUMBER,
  specialistNumber: process.env.SPECIALIST_NUMBER,
  publicUrl: process.env.PUBLIC_URL,
  port: Number(process.env.PORT || 8787),
  assistantModel: process.env.AI_ASSISTANT_MODEL || "openai/gpt-4o",
  assistantVoice: process.env.AI_ASSISTANT_VOICE || "voice ultra katie",
};

const sessions = new Map();

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requiredConfig() {
  return {
    telnyxApiKey: requireEnv("TELNYX_API_KEY", config.telnyxApiKey),
    connectionId: requireEnv("CONNECTION_ID", config.connectionId),
    telnyxNumber: requireEnv("TELNYX_NUMBER", config.telnyxNumber),
    specialistNumber: requireEnv("SPECIALIST_NUMBER", config.specialistNumber),
    publicUrl: requireEnv("PUBLIC_URL", config.publicUrl),
  };
}

function assertCallControlId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{6,128}$/.test(value)) {
    throw new Error("Invalid call_control_id received from webhook");
  }
  return value;
}

function telnyxHeaders() {
  const { telnyxApiKey } = requiredConfig();
  return {
    Authorization: `Bearer ${telnyxApiKey}`,
    "Content-Type": "application/json",
  };
}

async function parseTelnyxResponse(response) {
  if (!response.ok) {
    throw new Error(`Telnyx request failed ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function createSession(callControlId) {
  const session = {
    id: `mp_${Date.now()}`,
    callerCallControlId: callControlId,
    specialistCallControlId: "",
    conversationId: "",
    consentGranted: false,
    issueSummary: "",
    status: "caller_connected",
    events: [],
  };
  sessions.set(session.id, session);
  return session;
}

function activeSession() {
  return Array.from(sessions.values()).find((session) => session.status !== "ended");
}

function findSessionByCallControlId(callControlId) {
  return Array.from(sessions.values()).find(
    (session) =>
      session.callerCallControlId === callControlId ||
      session.specialistCallControlId === callControlId,
  );
}

function recordEvent(session, event) {
  session.events.push({ ...event, at: new Date().toISOString() });
}

function buildAssistantConfig() {
  const { publicUrl } = requiredConfig();

  return {
    model: config.assistantModel,
    voice_settings: {
      voice: config.assistantVoice,
    },
    greeting: "Thanks for calling Telnyx developer support. How can I help today?",
    instructions: [
      "You are a Telnyx developer support AI assistant.",
      "You triage inbound developer support calls and coordinate a human handoff when deeper help is needed.",
      "Ask one focused question at a time.",
      "If the caller needs specialist help, ask for consent before adding another participant.",
      "After consent, call record_specialist_consent with granted=true.",
      "Then call dial_specialist to add the specialist to this same live AI conversation.",
      "When the specialist joins, summarize the caller's issue and what needs investigation.",
      "After the specialist joins, avoid taking over the conversation. Speak only when useful for coordination or follow-up.",
    ].join("\n"),
    tools: [
      {
        type: "webhook",
        webhook: {
          name: "classify_issue",
          description: "Classify the caller's support issue before deciding whether a specialist should join.",
          url: `${publicUrl}/tools/classify-issue`,
          method: "POST",
          async: false,
          body_parameters: {
            type: "object",
            properties: {
              issue_summary: {
                type: "string",
                description: "Short summary of the caller's issue.",
              },
            },
            required: ["issue_summary"],
          },
        },
      },
      {
        type: "webhook",
        webhook: {
          name: "record_specialist_consent",
          description: "Record whether the caller agreed to add a human specialist to the live call.",
          url: `${publicUrl}/tools/record-specialist-consent`,
          method: "POST",
          async: false,
          body_parameters: {
            type: "object",
            properties: {
              granted: {
                type: "boolean",
                description: "true if the caller agreed to add the specialist.",
              },
            },
            required: ["granted"],
          },
        },
      },
      {
        type: "webhook",
        webhook: {
          name: "dial_specialist",
          description: "Dial the human specialist and join them to the active AI conversation.",
          url: `${publicUrl}/tools/dial-specialist`,
          method: "POST",
          async: true,
          body_parameters: {
            type: "object",
            properties: {},
            required: [],
          },
        },
      },
    ],
  };
}

async function answerCallWithAssistant(callControlId) {
  const { publicUrl } = requiredConfig();
  const id = encodeURIComponent(assertCallControlId(callControlId));
  const response = await fetch(`https://api.telnyx.com/v2/calls/${id}/actions/answer`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({
      webhook_url: `${publicUrl}/webhooks/voice`,
      webhook_url_method: "POST",
      assistant: buildAssistantConfig(),
    }),
  });
  await parseTelnyxResponse(response);
}

async function dialSpecialist(session) {
  const { connectionId, telnyxNumber, specialistNumber, publicUrl } = requiredConfig();
  const clientState = Buffer.from(JSON.stringify({ sessionId: session.id, role: "specialist" })).toString(
    "base64",
  );

  const response = await fetch("https://api.telnyx.com/v2/calls", {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({
      connection_id: connectionId,
      from: telnyxNumber,
      to: specialistNumber,
      webhook_url: `${publicUrl}/webhooks/voice`,
      webhook_url_method: "POST",
      client_state: clientState,
    }),
  });
  const call = await parseTelnyxResponse(response);

  session.specialistCallControlId = call.data.call_control_id;
  session.status = "dialing_specialist";
  recordEvent(session, {
    type: "specialist_dialed",
    call_control_id: session.specialistCallControlId,
  });
}

async function joinSpecialistToAiConversation(session, specialistCallControlId) {
  if (!session.conversationId) {
    throw new Error("Missing AI conversation_id. Wait for an ai.* webhook before joining a participant.");
  }

  const id = encodeURIComponent(assertCallControlId(specialistCallControlId));
  const response = await fetch(`https://api.telnyx.com/v2/calls/${id}/actions/ai_assistant_join`, {
    method: "POST",
    headers: telnyxHeaders(),
    body: JSON.stringify({
      conversation_id: session.conversationId,
      participant: {
        id: specialistCallControlId,
        role: "user",
        name: "support specialist",
        on_hangup: "continue_conversation",
      },
    }),
  });
  await parseTelnyxResponse(response);

  session.status = "multiparticipant_active";
  recordEvent(session, {
    type: "specialist_joined_ai_conversation",
    conversation_id: session.conversationId,
    call_control_id: specialistCallControlId,
  });
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ai_assistant_multiparticipant_calling" });
});

app.get("/sessions", (_req, res) => {
  res.json({ sessions: Array.from(sessions.values()) });
});

app.post("/webhooks/voice", async (req, res) => {
  res.sendStatus(200);

  const eventType = req.body?.data?.event_type;
  const payload = req.body?.data?.payload || {};
  const callControlId = payload.call_control_id;
  const direction = payload.direction;

  try {
    if (eventType === "call.initiated" && direction === "incoming") {
      const session = createSession(callControlId);
      recordEvent(session, { type: "inbound_call", call_control_id: callControlId });
      await answerCallWithAssistant(callControlId);
      return;
    }

    const session = findSessionByCallControlId(callControlId) || activeSession();
    if (!session) return;

    if (eventType?.startsWith("ai.")) {
      const conversationId = payload.conversation_id;
      if (conversationId && !session.conversationId) {
        session.conversationId = conversationId;
        recordEvent(session, { type: "conversation_captured", conversation_id: conversationId });
      }
      return;
    }

    if (eventType === "call.answered" && callControlId === session.specialistCallControlId) {
      await joinSpecialistToAiConversation(session, callControlId);
      return;
    }

    if (eventType === "call.hangup") {
      recordEvent(session, { type: "call_hangup", call_control_id: callControlId });
      if (callControlId === session.callerCallControlId) {
        session.status = "ended";
      }
    }
  } catch (error) {
    console.error("[voice webhook]", error);
  }
});

app.post("/tools/classify-issue", (req, res) => {
  const session = activeSession();
  const issueSummary = String(req.body?.issue_summary || "developer support request");

  if (session) {
    session.issueSummary = issueSummary;
    recordEvent(session, { type: "issue_classified", issue_summary: issueSummary });
  }

  res.json({
    classified: true,
    route_to_specialist: true,
    specialist_name: "support specialist",
    summary: issueSummary,
  });
});

app.post("/tools/record-specialist-consent", (req, res) => {
  const session = activeSession();
  if (!session) {
    res.status(409).json({ ok: false, error: "no_active_session" });
    return;
  }

  session.consentGranted = Boolean(req.body?.granted);
  recordEvent(session, { type: "specialist_consent", granted: session.consentGranted });
  res.json({ ok: true, consent_granted: session.consentGranted });
});

app.post("/tools/dial-specialist", async (_req, res) => {
  res.json({ status: "dialing_specialist", async: true });

  const session = activeSession();
  if (!session) {
    console.warn("[dial-specialist] no active session");
    return;
  }
  if (!session.consentGranted) {
    console.warn("[dial-specialist] consent has not been granted");
    return;
  }

  try {
    await dialSpecialist(session);
  } catch (error) {
    console.error("[dial-specialist]", error);
  }
});

if (process.env.NODE_ENV !== "test") {
  app.listen(config.port, () => {
    console.log(`AI Assistant Multiparticipant Calling listening on http://localhost:${config.port}`);
    console.log(`Voice webhook: ${config.publicUrl || "https://your-url"}/webhooks/voice`);
  });
}

export {
  app,
  buildAssistantConfig,
  joinSpecialistToAiConversation,
  sessions,
};
