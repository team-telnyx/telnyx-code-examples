#!/usr/bin/env node
/**
 * Text a meeting link to your Telnyx number and a bot joins the meeting for you.
 *
 * Flow: inbound SMS -> verify signature -> extract meeting URL -> create a
 * Telnyx meeting session -> text status updates -> text a TL;DR when it ends.
 */

require("dotenv").config();
const express = require("express");
const Telnyx = require("telnyx");

const {
  TELNYX_API_KEY,
  TELNYX_PUBLIC_KEY,
  TELNYX_PHONE_NUMBER,
  OWNER_PHONE_NUMBER,
  BOT_NAME = "Meeting Bot",
  CHAT_ON_ENTER = "Hi all - I am a bot attending on behalf of a colleague who could not make it. I will take notes and they will get a TL;DR after.",
  ASSISTANT_ID,
  CAMERA_IMAGE_URL,
  PORT = 3000,
} = process.env;

for (const [name, value] of Object.entries({
  TELNYX_API_KEY,
  TELNYX_PUBLIC_KEY,
  TELNYX_PHONE_NUMBER,
  OWNER_PHONE_NUMBER,
})) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

const client = new Telnyx({ apiKey: TELNYX_API_KEY, publicKey: TELNYX_PUBLIC_KEY });

const MEETING_URL_PATTERN =
  /https?:\/\/[^\s]*(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com)[^\s]*/i;
const IN_PROGRESS = ["joining", "waiting_for_admission", "active"];
const TERMINAL = ["ended", "failed", "admission_denied"];
const POLL_INTERVAL_MS = 5000;
const SUMMARY_TIMEOUT_MS = 90000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// In-memory state (use a database in production so restarts don't lose sessions)
const watchedSessions = new Map(); // sessionId -> last status we texted about

async function sendSms(text) {
  const response = await client.messages.send({
    from: TELNYX_PHONE_NUMBER,
    to: OWNER_PHONE_NUMBER,
    text,
  });
  console.log(`[sms] sent id=${response.data?.id ?? "n/a"}`);
}

/**
 * Webex has no native meeting chat, and the API rejects chat_on_enter there
 * with 422 unsupported_capability. Google Meet, Zoom, and Teams support it.
 */
function supportsChat(meetingUrl) {
  try {
    return !new URL(meetingUrl).hostname.endsWith("webex.com");
  } catch {
    return false;
  }
}

/**
 * Create the meeting session. The idempotency key is derived from the inbound
 * message ID so a webhook retry never puts a second bot in the meeting.
 */
async function joinMeeting(meetingUrl, messageId) {
  const params = {
    meeting_url: meetingUrl,
    bot_name: BOT_NAME,
    summarize_on_end: true,
    idempotency_key: `join-meeting-by-sms:${messageId}`,
  };
  if (supportsChat(meetingUrl)) params.chat_on_enter = CHAT_ON_ENTER;
  if (ASSISTANT_ID) {
    params.assistant = { id: ASSISTANT_ID, audio_gate: "half_duplex", leave_on_end: true };
  }
  if (CAMERA_IMAGE_URL) {
    params.camera_image = { format: "jpeg", url: CAMERA_IMAGE_URL };
  }
  const response = await client.meetingSessions.create(params);
  return response.data;
}

/** Return an in-progress session already attached to this meeting, if any. */
async function findActiveSession(meetingUrl) {
  const list = await client.meetingSessions.list({ "page[size]": 25 });
  return (list.data ?? []).find(
    (s) => s.meeting_url === meetingUrl && IN_PROGRESS.includes(s.status),
  );
}

async function fetchSummary(sessionId) {
  const deadline = Date.now() + SUMMARY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const artifacts = await client.meetingSessions.artifacts.list(sessionId);
    const summary = (artifacts.data ?? []).find((a) => a.type === "summary");
    if (summary?.status === "completed" && summary.content?.text) {
      return summary.content.text.trim();
    }
    if (summary?.status === "failed") return null;
    await sleep(3000);
  }
  return null;
}

const STATUS_MESSAGES = {
  waiting_for_admission: "Your bot is at the waiting room. A host needs to admit it.",
  active: "Your bot is in the meeting and taking notes. You will get a TL;DR when it ends.",
  admission_denied: "The host did not admit your bot, so no notes were taken.",
  failed: "Your bot could not join the meeting.",
};

/** Poll a session, text each status change once, and text the TL;DR at the end. */
async function watchSession(sessionId) {
  while (watchedSessions.has(sessionId)) {
    try {
      const { data: session } = await client.meetingSessions.retrieve(sessionId);
      if (session.status !== watchedSessions.get(sessionId)) {
        watchedSessions.set(sessionId, session.status);
        if (STATUS_MESSAGES[session.status]) await sendSms(STATUS_MESSAGES[session.status]);
      }
      if (TERMINAL.includes(session.status)) {
        if (session.status === "ended") {
          // A session that timed out in the waiting room also ends as "ended",
          // with joined_at null. Only a non-null joined_at proves the bot got in.
          if (!session.joined_at) {
            await sendSms("The meeting ended, but your bot was never admitted, so there are no notes.");
          } else {
            const summary = await fetchSummary(sessionId);
            await sendSms(
              summary
                ? `TL;DR: ${summary}`
                : "The meeting ended, but the summary is not available. The transcript is still in your Telnyx account.",
            );
          }
        }
        watchedSessions.delete(sessionId);
        return;
      }
    } catch (error) {
      console.error(`[watch] ${sessionId}: ${error.message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function handleInboundMessage(payload) {
  const from = payload.from?.phone_number;
  const text = (payload.text || "").trim();

  // Only the owner can send the bot into a meeting
  if (from !== OWNER_PHONE_NUMBER) {
    console.log("[skip] message is not from the owner number");
    return;
  }

  const meetingUrl = text.match(MEETING_URL_PATTERN)?.[0];
  if (!meetingUrl) {
    await sendSms("I did not find a meeting link. Text me a Google Meet, Zoom, Teams, or Webex URL.");
    return;
  }

  const existing = await findActiveSession(meetingUrl);
  if (existing) {
    if (!watchedSessions.has(existing.id)) {
      watchedSessions.set(existing.id, null);
      watchSession(existing.id);
    }
    await sendSms("Your bot is already in that meeting and taking notes.");
    return;
  }

  try {
    const session = await joinMeeting(meetingUrl, payload.id);
    console.log(`[join] session=${session.id} status=${session.status}`);
    await sendSms(
      supportsChat(meetingUrl)
        ? "On it. Your bot is joining now. I will text you when it is in and send a TL;DR after the meeting."
        : "On it. Your bot is joining now. This platform has no meeting chat, so the bot cannot announce itself. Let the host know. I will text you when it is in.",
    );
    if (!watchedSessions.has(session.id)) {
      watchedSessions.set(session.id, session.status);
      watchSession(session.id);
    }
  } catch (error) {
    console.error(`[join] failed: ${error.message}`);
    await sendSms("I could not send the bot to that meeting. Check the link and try again.");
  }
}

const app = express();

// The webhook route needs the RAW body so the Ed25519 signature can be verified.
// Do not mount a global express.json() ahead of it.
app.post("/webhooks/sms", express.raw({ type: "*/*" }), async (req, res) => {
  let event;
  try {
    event = await client.webhooks.unwrap(req.body.toString(), { headers: req.headers });
  } catch (error) {
    console.error(`[webhook] signature verification failed: ${error.message}`);
    return res.status(401).json({ error: "invalid signature" });
  }

  // Acknowledge immediately; Telnyx retries on non-2xx and expects a fast response
  res.status(200).json({ received: true });

  if (event.data?.event_type !== "message.received") return;
  try {
    await handleInboundMessage(event.data.payload);
  } catch (error) {
    console.error(`[webhook] handler error: ${error.message}`);
  }
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", watching: watchedSessions.size });
});

app.listen(PORT, () => {
  console.log(`join-meeting-by-sms listening on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhooks/sms`);
});
