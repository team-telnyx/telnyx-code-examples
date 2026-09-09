import { StatefulActor } from "@telnyx/edge-runtime";

export interface VoicemailRecord {
  recording_id: string;
  caller: string;
  transcript_preview: string;
  summary: string;
  sms_sent: boolean;
  archived: boolean;
  processed_at: string;
}

export interface VoicemailWebhookPayload {
  event?: string;
  data?: {
    payload?: {
      call_control_id?: string;
      from?: string;
      recording_id?: string;
      recording_url?: string;
      recording?: { id?: string };
    };
  };
}

export interface VoicemailWebhookEvent {
  data?: {
    event_type?: string;
    payload?: Record<string, unknown>;
  };
}

export interface Stats {
  total_voicemails: number;
  sms_sent: number;
  archived: number;
}

const TELNYX_API = "https://api.telnyx.com/v2";
const MAX_STORED = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
  };
}

async function downloadRecordingAudio(apiKey: string, payload: Record<string, any>): Promise<ArrayBuffer> {
  const directUrl = payload.recording_url;
  if (directUrl) {
    const resp = await fetch(directUrl);
    if (!resp.ok) throw new Error(`recording download failed: HTTP ${resp.status}`);
    return resp.arrayBuffer();
  }

  const recordingId = payload.recording_id || payload.recording?.id;
  if (!recordingId) throw new Error("no recording_url or recording_id in webhook payload");

  const metaResp = await fetch(`${TELNYX_API}/recordings/${recordingId}`, {
    headers: authHeaders(apiKey),
  });
  if (!metaResp.ok) throw new Error(`recording lookup failed: HTTP ${metaResp.status}`);
  const meta = (await metaResp.json()) as any;
  const urls = meta?.data?.download_urls ?? meta?.data?.recording_urls ?? {};
  const audioUrl = urls.mp3 || urls.wav || urls.wave;
  if (!audioUrl) throw new Error("no downloadable recording URL found");

  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) throw new Error(`audio download failed: HTTP ${audioResp.status}`);
  return audioResp.arrayBuffer();
}

async function transcribeAudio(apiKey: string, audio: ArrayBuffer, model: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/mpeg" }), "voicemail.mp3");
  form.append("model", model);

  const resp = await fetch(`${TELNYX_API}/ai/audio/transcriptions`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: form,
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`STT failed: HTTP ${resp.status}: ${err}`);
  }
  const data = (await resp.json()) as any;
  const text = data?.data?.text ?? data?.text;
  if (!text) throw new Error("no transcription text returned");
  return text;
}

function stripCodeFences(text: string): string {
  let out = text.trim();
  if (out.startsWith("```")) {
    out = out.split("\n").slice(1).join("\n").replace(/```/g, "").trim();
  }
  return out;
}

async function summarizeTranscript(apiKey: string, model: string, caller: string, transcript: string): Promise<string> {
  const resp = await fetch(`${TELNYX_API}/ai/chat/completions`, {
    method: "POST",
    headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant. Summarize the following voicemail transcription into a concise SMS message (max 160 chars) for the mailbox owner. Include the caller number if relevant. Return only the summary text.",
        },
        {
          role: "user",
          content: `Caller: ${caller}\nTranscription: ${transcript}`,
        },
      ],
      max_tokens: 2000,
      temperature: 0.3,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`inference failed: HTTP ${resp.status}: ${err}`);
  }
  const data = (await resp.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("no content from model");
  return stripCodeFences(content) || "New voicemail received.";
}

async function sendSms(apiKey: string, from: string, to: string, text: string): Promise<void> {
  const resp = await fetch(`${TELNYX_API}/messages`, {
    method: "POST",
    headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, text }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`SMS send failed: HTTP ${resp.status}: ${err}`);
  }
}

async function archiveAudio(apiKey: string, bucket: string, key: string, audio: ArrayBuffer): Promise<void> {
  const resp = await fetch(`${TELNYX_API}/storage/buckets/${bucket}/${key}`, {
    method: "PUT",
    headers: { ...authHeaders(apiKey), "Content-Type": "audio/mpeg" },
    body: audio,
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`archive upload failed: HTTP ${resp.status}: ${err}`);
  }
}

export class VoicemailAgent extends StatefulActor {
  private handlerConfig: Record<string, string | undefined> = {};

  private cfg(name: string): string | undefined {
    return this.handlerConfig[name] ?? ((this.env as any)?.[name] as string | undefined) ?? process.env[name];
  }

  private async getApiKey(): Promise<string> {
    const envAny = this.env as any;
    if (envAny?.SECRETS?.get) {
      try {
        const key = await envAny.SECRETS.get("TELNYX_API_KEY");
        if (key) return key;
      } catch (e) {
        console.warn("SECRETS.get failed, falling back to process.env:", e instanceof Error ? e.message : e);
      }
    }
    const key = process.env.TELNYX_API_KEY ?? "";
    if (!key) throw new Error("TELNYX_API_KEY not available (SECRETS binding or process.env)");
    return key;
  }

  async handleEvent(event: VoicemailWebhookEvent, config?: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    if (config) this.handlerConfig = config;
    const eventType = event?.data?.event_type ?? "";
    const payload = (event?.data?.payload ?? {}) as Record<string, any>;
    await this.logDebug({ ts: new Date().toISOString(), event: eventType, from: payload.from, direction: payload.direction });

    if (eventType === "call.initiated") {
      if (payload.direction !== "incoming") return { status: "ignored" };
      await this.callControlAction(payload.call_control_id, "answer");
      await this.markCall(payload.call_control_id, "answering", payload.from);
      return { status: "answered", call_control_id: payload.call_control_id };
    }

    if (eventType === "call.answered") {
      const stage = await this.callStage(payload.call_control_id);
      if (!stage || stage !== "answering") return { status: "ignored" };
      await this.callControlAction(payload.call_control_id, "record_start", {
        format: "mp3",
        channels: "dual",
        play_beep: true,
      });
      await sleep(1000);
      const greeting =
        this.cfg("VOICEMAIL_GREETING") ||
        "Hi, you've reached the mailbox owner's voicemail. Please leave a message after the tone.";
      await this.callControlAction(payload.call_control_id, "speak", {
        payload: greeting,
        voice: "female",
        language: "en-US",
      });
      await this.markCall(payload.call_control_id, "recording", payload.from);
      return { status: "recording", call_control_id: payload.call_control_id };
    }

    if (eventType === "call.hangup") {
      await this.markCall(payload.call_control_id, "ended", payload.from);
      return { status: "ignored" };
    }

    if (eventType === "call.recording.saved" || payload.recording_id || payload.recording_url) {
      const recordingId = payload.recording_id || payload.recording?.id || "unknown";
      if (await this.hasRecording(recordingId)) {
        return { status: "duplicate", recording_id: recordingId };
      }
      const sessionKey =
        payload.call_session_id || payload.call_leg_id || payload.call_control_id;
      if (sessionKey && (await this.isSessionProcessed(sessionKey))) {
        return { status: "duplicate_session", session: sessionKey };
      }
      if (!payload.from) {
        payload.from = (await this.callFrom(payload.call_control_id)) || "unknown";
      }
      let result: Record<string, unknown>;
      try {
        result = await this.processVoicemail({ data: { payload: payload as any } });
      } catch (e) {
        await this.logDebug({
          ts: new Date().toISOString(),
          step: "pipeline_failed",
          error: (e instanceof Error ? e.message : String(e)).slice(0, 300),
        });
        throw e;
      }
      if (sessionKey) await this.markSessionProcessed(sessionKey);
      await this.forgetCall(payload.call_control_id);
      return result;
    }

    return { status: "ignored", event: eventType };
  }

  private async activeCalls(): Promise<Record<string, { stage: string; from?: string }>> {
    return (await this.ctx.storage.get<Record<string, { stage: string; from?: string }>>("active_calls")) ?? {};
  }

  private async markCall(callControlId: string, stage: string, from?: string): Promise<void> {
    if (!callControlId) return;
    const calls = await this.activeCalls();
    const prev = calls[callControlId];
    calls[callControlId] = { stage, from: from || prev?.from };
    const entries = Object.entries(calls);
    if (entries.length > 50) {
      for (const [key, val] of entries) {
        if (val.stage === "ended") delete calls[key];
      }
    }
    await this.ctx.storage.put("active_calls", calls);
  }

  private async callStage(callControlId: string): Promise<string | undefined> {
    if (!callControlId) return undefined;
    return (await this.activeCalls())[callControlId]?.stage;
  }

  private async callFrom(callControlId: string): Promise<string | undefined> {
    if (callControlId) {
      const info = (await this.activeCalls())[callControlId];
      if (info?.from) return info.from;
    }
    const calls = await this.activeCalls();
    const withFrom = Object.values(calls).find((c) => c.from);
    return withFrom?.from;
  }

  private async forgetCall(callControlId: string): Promise<void> {
    if (!callControlId) return;
    const calls = await this.activeCalls();
    if (calls[callControlId]) {
      delete calls[callControlId];
      await this.ctx.storage.put("active_calls", calls);
    }
  }

  private async hasRecording(recordingId: string): Promise<boolean> {
    if (recordingId === "unknown") return false;
    const map = await this.getMap();
    return recordingId in map;
  }

  private async processedSessions(): Promise<Record<string, boolean>> {
    return (await this.ctx.storage.get<Record<string, boolean>>("processed_sessions")) ?? {};
  }

  private async isSessionProcessed(sessionKey: string): Promise<boolean> {
    return (await this.processedSessions())[sessionKey] === true;
  }

  private async markSessionProcessed(sessionKey: string): Promise<void> {
    const sessions = await this.processedSessions();
    sessions[sessionKey] = true;
    const keys = Object.keys(sessions);
    if (keys.length > 200) {
      for (const k of keys.slice(0, keys.length - 200)) delete sessions[k];
    }
    await this.ctx.storage.put("processed_sessions", sessions);
  }

  private async logDebug(entry: Record<string, unknown>): Promise<void> {
    const events = (await this.ctx.storage.get<Record<string, unknown>[]>("debug_events")) ?? [];
    events.unshift(entry);
    await this.ctx.storage.put("debug_events", events.slice(0, 20));
  }

  async debugEvents(): Promise<Record<string, unknown>[]> {
    return (await this.ctx.storage.get<Record<string, unknown>[]>("debug_events")) ?? [];
  }

  private async callControlAction(
    callControlId: string,
    action: "answer" | "record_start" | "speak" | "hangup",
    body?: Record<string, unknown>
  ): Promise<void> {
    const apiKey = await this.getApiKey();
    if (!callControlId) throw new Error("missing call_control_id");
    const resp = await fetch(`${TELNYX_API}/calls/${callControlId}/actions/${action}`, {
      method: "POST",
      headers: { ...authHeaders(apiKey), "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (!resp.ok) {
      const err = await resp.text();
      await this.logDebug({ ts: new Date().toISOString(), action, ok: false, status: resp.status, detail: err.slice(0, 300) });
      throw new Error(`${action} failed: HTTP ${resp.status}: ${err}`);
    }
    await this.logDebug({ ts: new Date().toISOString(), action, ok: true });
  }

  async processVoicemail(payload: VoicemailWebhookPayload): Promise<Record<string, unknown>> {
    const inner = payload?.data?.payload ?? {};
    const apiKey = await this.getApiKey();

    const callControlId = inner.call_control_id;
    if (!callControlId) throw new Error("Missing call_control_id in voicemail webhook");
    const callerNumber = inner.from || "unknown";
    const recordingId = inner.recording_id || inner.recording?.id || "unknown";

    const audio = await downloadRecordingAudio(apiKey, inner as Record<string, any>);
    await this.logDebug({ ts: new Date().toISOString(), step: "audio_downloaded", bytes: audio.byteLength });

    const sttModel = this.cfg("STT_MODEL") || "distil-whisper/distil-large-v2";
    const transcript = await transcribeAudio(apiKey, audio, sttModel);
    await this.logDebug({ ts: new Date().toISOString(), step: "transcribed", chars: transcript.length });

    const llmModel = this.cfg("AI_MODEL") || "moonshotai/Kimi-K2.6";
    const summary = await summarizeTranscript(apiKey, llmModel, callerNumber, transcript);
    await this.logDebug({ ts: new Date().toISOString(), step: "summarized", chars: summary.length });

    const liveMode = this.cfg("LIVE_MODE") === "true";
    const smsText = `Voicemail from ${callerNumber}: ${summary}`;
    let smsSent = false;

    const destination = this.cfg("MAILBOX_OWNER_NUMBER");
    const fromNumber = this.cfg("TELNYX_SMS_NUMBER");
    if (!destination || !fromNumber) throw new Error("MAILBOX_OWNER_NUMBER and TELNYX_SMS_NUMBER must be configured");

    if (liveMode) {
      await sendSms(apiKey, fromNumber, destination, smsText);
      smsSent = true;
      await this.logDebug({ ts: new Date().toISOString(), step: "sms_sent", to: destination });
    } else {
      console.log("[demo] SMS not sent. Would send:", { to: destination, text: smsText });
      await this.logDebug({ ts: new Date().toISOString(), step: "sms_demo_mode", to: destination });
    }

    let archived = false;
    if (liveMode) {
      const key = `voicemails/${recordingId}.mp3`;
      try {
        const storage = (this.env as any)?.ARCHIVE;
        if (storage?.put) {
          await storage.put(key, audio, { contentType: "audio/mpeg" });
        } else {
          await archiveAudio(apiKey, this.cfg("STORAGE_BUCKET") || "voicemail-archives", key, audio);
        }
        archived = true;
      } catch (e) {
        console.warn("audio archiving failed (non-fatal):", e instanceof Error ? e.message : e);
      }
    } else {
      console.log("[demo] Audio not archived. Would upload to:", {
        bucket: this.cfg("STORAGE_BUCKET") || "voicemail-archives",
        key: `voicemails/${recordingId}.mp3`,
      });
    }

    const record: VoicemailRecord = {
      recording_id: recordingId,
      caller: callerNumber,
      transcript_preview: transcript.slice(0, 120),
      summary,
      sms_sent: smsSent,
      archived,
      processed_at: new Date().toISOString(),
    };
    await this.saveRecord(record);

    return { status: "success", recording_id: recordingId, summary, sms_sent: smsSent, archived };
  }

  private async getMap(): Promise<Record<string, VoicemailRecord>> {
    return (await this.ctx.storage.get<Record<string, VoicemailRecord>>("voicemails")) ?? {};
  }

  private async saveRecord(record: VoicemailRecord): Promise<void> {
    const map = await this.getMap();
    map[record.recording_id] = record;
    const entries = Object.entries(map);
    if (entries.length > MAX_STORED) {
      entries.sort((a, b) => a[1].processed_at.localeCompare(b[1].processed_at));
      for (const [key] of entries.slice(0, entries.length - MAX_STORED)) {
        delete map[key];
      }
    }
    await this.ctx.storage.put("voicemails", map);
  }

  async listVoicemails(): Promise<VoicemailRecord[]> {
    const map = await this.getMap();
    return Object.values(map).sort((a, b) => b.processed_at.localeCompare(a.processed_at));
  }

  async getStats(): Promise<Stats> {
    const records = await this.listVoicemails();
    return {
      total_voicemails: records.length,
      sms_sent: records.filter((r) => r.sms_sent).length,
      archived: records.filter((r) => r.archived).length,
    };
  }
}
