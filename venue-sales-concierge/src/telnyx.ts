import type { Env } from "./types";
import { apiKey, cfg, envVarsSnapshot } from "./types";

const TELNYX_API = "https://api.telnyx.com/v2";

function authHeaders(extra?: Record<string, string>): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

// ── AI Inference (zero-credential via the [telnyx] binding) ────────────────
// Tries the primary model first, then walks the fallback chain
// (AI_MODEL_FALLBACKS — e.g. zai-org/GLM-5.3-Flash) on error or empty reply.
export async function complete(
  env: Env,
  messages: Array<{ role: string; content: string }>,
  opts?: { maxTokens?: number; temperature?: number },
): Promise<string> {
  const config = cfg(env);
  const models = [config.AI_MODEL, ...config.AI_MODEL_FALLBACKS];
  for (const model of models) {
    try {
      const completion = await env.TELNYX.ai.openai.chat.createCompletion({
        model,
        messages,
        max_tokens: opts?.maxTokens ?? 4000,
        temperature: opts?.temperature ?? 0.4,
      });
      const content = completion.choices?.[0]?.message?.content?.trim();
      if (content) return content;
      console.error(`inference returned empty content from ${model}`);
    } catch (e) {
      console.error(`inference failed for ${model}:`, e instanceof Error ? e.message : e);
    }
  }
  return "";
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

// ── Messaging (SMS over POST /v2/messages) ─────────────────────────────────
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

// ── Call Control (outbound follow-up + in-call commands) ───────────────────

/** Start an outbound call on a Call Control connection (webhooks return here). */
export async function dialCall(
  connectionId: string,
  from: string,
  to: string,
  clientState?: string,
  bearer?: string,
): Promise<{ ok: boolean; callControlId?: string; status: number; err?: string }> {
  const body: Record<string, unknown> = { connection_id: connectionId, from, to };
  if (clientState) body.client_state = Buffer.from(clientState).toString("base64");
  if (process.env.PUBLIC_ORIGIN) body.webhook_url = `${process.env.PUBLIC_ORIGIN}/webhooks/voice`;
  const resp = await fetch(`${TELNYX_API}/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer ?? apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    return { ok: false, status: resp.status, err: (await resp.text()).slice(0, 300) };
  }
  const data = (await resp.json()) as { data?: { call_control_id?: string } };
  return { ok: true, callControlId: data.data?.call_control_id, status: resp.status };
}

/** Issue a Call Control command (answer, speak, gather_using_speak, hangup…). */
export async function callCommand(
  callControlId: string,
  command: string,
  payload: Record<string, unknown>,
  bearer?: string,
): Promise<{ ok: boolean; status: number; err?: string }> {
  const resp = await fetch(`${TELNYX_API}/calls/${callControlId}/actions/${command}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer ?? apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (resp.ok) return { ok: true, status: resp.status };
  return { ok: false, status: resp.status, err: (await resp.text()).slice(0, 300) };
}

export function speakPayload(text: string, language = "en-US"): Record<string, unknown> {
  return { payload: text, voice: "female", language };
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
  const listResp = await fetch(`${TELNYX_API}/ai/assistants`, {
    headers: authHeaders(),
  });
  if (listResp.ok) {
    const list = (await listResp.json()) as {
      data?: Array<{ id: string; name?: string }>;
    };
    const existing = list.data?.find((a) => a.name === name);
    if (existing) {
      const putResp = await fetch(`${TELNYX_API}/ai/assistants/${existing.id}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          instructions,
          greeting,
          tools,
          telephony_settings: telephonySettings,
          model: envVarsSnapshot().ASSISTANT_MODEL,
        }),
      });
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
      model: envVarsSnapshot().ASSISTANT_MODEL,
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
