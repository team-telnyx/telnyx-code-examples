import { apiKey, envVars, type Env } from "./types";

const TELNYX_API = "https://api.telnyx.com/v2";

function authHeaders(extra?: Record<string, string>): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

// ── AI Inference (zero-credential via the [telnyx] binding) ────────────────
export async function complete(
  env: Env,
  messages: Array<{ role: string; content: string }>,
  opts?: { maxTokens?: number; temperature?: number },
): Promise<string> {
  const completion = await env.TELNYX.ai.openai.chat.createCompletion({
    model: envVars.AI_MODEL,
    messages,
    max_tokens: opts?.maxTokens ?? 4000,
    temperature: opts?.temperature ?? 0.4,
  });
  return completion.choices?.[0]?.message?.content?.trim() ?? "";
}

/** Ask the model for a JSON object; strips markdown fences and parses. */
export async function completeJson<T>(
  env: Env,
  system: string,
  user: string,
): Promise<T | null> {
  let content = await complete(
    env,
    [
      { role: "system", content: `${system}\nRespond with JSON only.` },
      { role: "user", content: user },
    ],
    { maxTokens: 4000, temperature: 0.2 },
  );
  if (content.startsWith("```")) {
    content = content.split("\n").slice(1).join("\n").replace(/```/g, "").trim();
  }
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(content.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

// ── Messaging (SMS + WhatsApp over POST /v2/messages) ──────────────────────
export async function sendSms(
  from: string,
  to: string,
  text: string,
): Promise<{ ok: boolean; status: number; err?: string }> {
  const resp = await fetch(`${TELNYX_API}/messages`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ from, to, text }),
  });
  if (resp.ok) return { ok: true, status: resp.status };
  return { ok: false, status: resp.status, err: (await resp.text()).slice(0, 300) };
}

// ── Email (Telnyx Email API — shared sending domain works out of the box) ──
export async function sendEmail(
  from: string,
  to: string,
  subject: string,
  textBody: string,
): Promise<{ ok: boolean; status: number; err?: string }> {
  const resp = await fetch(`${TELNYX_API}/email_messages`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ from, to: [to], subject, text_body: textBody }),
  });
  if (resp.ok) return { ok: true, status: resp.status };
  return { ok: false, status: resp.status, err: (await resp.text()).slice(0, 300) };
}

// ── Speech-to-text (Whisper via POST /v2/ai/audio/transcriptions) ──────────
export async function transcribeAudio(
  audio: Blob,
  filename: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", envVars.TRANSCRIBE_MODEL);
  const resp = await fetch(`${TELNYX_API}/ai/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  if (!resp.ok) {
    throw new Error(
      `transcription failed: HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`,
    );
  }
  const data = (await resp.json()) as { text?: string };
  return (data.text ?? "").trim();
}

// ── AI Assistants (browser voice target + webhook tool wiring) ─────────────
export interface AssistantTool {
  type: "webhook";
  webhook: {
    name: string;
    description: string;
    url: string;
    method: "GET" | "POST";
    body_parameters?: Record<string, unknown>;
  };
}

export async function upsertAssistant(
  name: string,
  instructions: string,
  greeting: string,
  tools: AssistantTool[],
): Promise<{ id: string }> {
  // Required for in-browser (anonymous WebRTC) access — without this the
  // signaling server rejects anonymous_login with "Login Incorrect".
  const telephonySettings = { supports_unauthenticated_web_calls: true };

  // Reuse an existing assistant with the same name, else create one.
  const listResp = await fetch(`${TELNYX_API}/ai/assistants`, {
    headers: authHeaders(),
  });
  if (listResp.ok) {
    const list = (await listResp.json()) as {
      data?: Array<{ id: string; name?: string }>;
    };
    const existing = list.data?.find((a) => a.name === name);
    if (existing) {
      const putResp = await fetch(
        `${TELNYX_API}/ai/assistants/${existing.id}`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ instructions, greeting, tools, telephony_settings: telephonySettings }),
        },
      );
      if (!putResp.ok) {
        throw new Error(
          `assistant update failed: HTTP ${putResp.status}: ${(await putResp.text()).slice(0, 300)}`,
        );
      }
      return { id: existing.id };
    }
  }

  const createResp = await fetch(`${TELNYX_API}/ai/assistants`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      name,
      instructions,
      greeting,
      tools,
      telephony_settings: telephonySettings,
      model: process.env.ASSISTANT_MODEL ?? "moonshotai/Kimi-K2.6",
    }),
  });
  if (!createResp.ok) {
    throw new Error(
      `assistant create failed: HTTP ${createResp.status}: ${(await createResp.text()).slice(0, 300)}`,
    );
  }
  const created = (await createResp.json()) as {
    data?: { id?: string } | { id?: string };
  };
  const createdId =
    (created.data as { id?: string } | undefined)?.id ??
    (created as { id?: string }).id;
  if (!createdId) throw new Error("assistant create returned no id");
  return { id: createdId };
}
