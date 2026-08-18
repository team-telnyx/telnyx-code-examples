import { Agent } from "@telnyx/edge-runtime";

// ── State ────────────────────────────────────────────────────────────────
export interface VoicemailState extends Record<string, unknown> {
  audioKey: string;        // S3 object key in Cloud Storage
  bucket: string;          // S3 bucket name
  recipientPhone: string;  // who gets the SMS summary
  senderPhone: string;     // Telnyx number sending the SMS
  transcript: string;      // STT result
  summary: string;         // LLM result
  status: "pending" | "transcribing" | "summarizing" | "sending" | "done" | "error";
  error: string;
  createdAt: number;
  completedAt: number;
}

// ── Env: [telnyx] binding + API key secret ───────────────────────────────
interface VoicemailEnv {
  TELNYX: {
    messages: {
      send(m: { from: string; to: string; text: string }): Promise<unknown>;
    };
    ai: {
      openai: {
        chat: {
          createCompletion(req: {
            model: string;
            messages: Array<{ role: string; content: string }>;
            max_tokens?: number;
            temperature?: number;
          }): Promise<{ choices: Array<{ message: { content: string } }> }>;
        };
      };
    };
  };
  TELNYX_API_KEY: string;
  STORAGE_BUCKET: string;
  STORAGE_REGION: string;
  AI_MODEL: string;
}

const STT_URL = "https://api.telnyx.com/v2/ai/audio/transcriptions";
const STORAGE_HOST_SUFFIX = ".telnyxcloudstorage.com";

const SUMMARIZE_SYSTEM_PROMPT = `You are a voicemail summarizer. Given a voicemail transcript, produce a concise SMS-friendly summary in 1-3 sentences. Include:
- Who called (if mentioned)
- What they wanted
- Any action items or deadlines
Keep it under 160 characters so it fits in a single SMS. Do not add quotes or labels — just the summary text.`;

/**
 * VoicemailAgent — one actor instance per voicemail upload.
 *
 * Pipeline (each stage queued for non-blocking execution):
 *   1. transcribe() — download audio from Cloud Storage → STT via Inference API
 *   2. summarize()   — LLM via this.env.TELNYX.ai.openai.chat.createCompletion()
 *   3. notify()      — SMS summary via this.env.TELNYX.messages.send()
 */
export class VoicemailAgent extends Agent<VoicemailEnv, VoicemailState> {
  protected override initialState(): VoicemailState {
    return {
      audioKey: "",
      bucket: "",
      recipientPhone: "",
      senderPhone: "",
      transcript: "",
      summary: "",
      status: "pending",
      error: "",
      createdAt: 0,
      completedAt: 0,
    };
  }

  /** Entry point — called by the webhook handler after audio is uploaded to Cloud Storage. */
  async start(params: {
    audioKey: string;
    bucket: string;
    recipientPhone: string;
    senderPhone: string;
  }): Promise<void> {
    await this.setState({
      audioKey: params.audioKey,
      bucket: params.bucket,
      recipientPhone: params.recipientPhone,
      senderPhone: params.senderPhone,
      status: "transcribing",
      createdAt: Date.now(),
    });
    await this.queue("transcribe");
  }

  /** Stage 1: Download audio from Cloud Storage and transcribe via Telnyx STT API. */
  async transcribe(): Promise<void> {
    const state = await this.getState();
    try {
      // Download audio from S3-compatible Cloud Storage
      const audioBytes = await this.downloadFromStorage(state.audioKey, state.bucket);

      // Send to Telnyx AI Audio Transcriptions API
      const formData = new FormData();
      formData.append("file", new Blob([audioBytes]), state.audioKey);
      formData.append("model", "whisper-large-v3-turbo");

      const resp = await fetch(STT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.TELNYX_API_KEY}`,
        },
        body: formData,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "unknown error");
        throw new Error(`STT failed: ${resp.status} ${errText.slice(0, 200)}`);
      }

      const data = await resp.json() as { text?: string; error?: string };
      const transcript = (data.text || "").trim();

      if (!transcript) {
        throw new Error("STT returned empty transcript");
      }

      await this.setState({ transcript, status: "summarizing" });
      await this.queue("summarize");
    } catch (e: any) {
      await this.setState({
        status: "error",
        error: `transcribe: ${e?.message || String(e)}`,
        completedAt: Date.now(),
      });
    }
  }

  /** Stage 2: Summarize the transcript via LLM (zero-credential binding). */
  async summarize(): Promise<void> {
    const state = await this.getState();
    try {
      const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model: this.env.AI_MODEL || "zai-org/GLM-5.2",
        messages: [
          { role: "system", content: SUMMARIZE_SYSTEM_PROMPT },
          { role: "user", content: state.transcript },
        ],
        max_tokens: 200,
        temperature: 0.3,
      });

      const summary = completion.choices[0]?.message?.content?.trim() || "";

      if (!summary) {
        throw new Error("LLM returned empty summary");
      }

      await this.setState({ summary, status: "sending" });
      await this.queue("notify");
    } catch (e: any) {
      await this.setState({
        status: "error",
        error: `summarize: ${e?.message || String(e)}`,
        completedAt: Date.now(),
      });
    }
  }

  /** Stage 3: Send the summary via SMS (zero-credential binding). */
  async notify(): Promise<void> {
    const state = await this.getState();
    try {
      await this.env.TELNYX.messages.send({
        from: state.senderPhone,
        to: state.recipientPhone,
        text: state.summary,
      });

      await this.setState({ status: "done", completedAt: Date.now() });
    } catch (e: any) {
      await this.setState({
        status: "error",
        error: `notify: ${e?.message || String(e)}`,
        completedAt: Date.now(),
      });
    }
  }

  /** Debug helper — return current state for inspection. */
  async getStatus(): Promise<VoicemailState> {
    return await this.getState();
  }

  // ── Cloud Storage (S3-compatible) ──────────────────────────────────────

  /** Download an object from Telnyx Cloud Storage using S3 GET with SigV4. */
  private async downloadFromStorage(key: string, bucket: string): Promise<ArrayBuffer> {
    const region = this.env.STORAGE_REGION || "us-central-1";
    const host = `${region}${STORAGE_HOST_SUFFIX}`;
    const endpoint = `https://${host}/${bucket}/${key}`;

    const headers = await this.s3SignV4("GET", host, `/${bucket}/${key}`, region, {});
    const resp = await fetch(endpoint, { method: "GET", headers });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown error");
      throw new Error(`S3 GET failed: ${resp.status} ${errText.slice(0, 200)}`);
    }

    return await resp.arrayBuffer();
  }

  /** Upload an object to Telnyx Cloud Storage using S3 PUT with SigV4. */
  static async uploadToStorage(
    apiKey: string,
    bucket: string,
    key: string,
    data: ArrayBuffer,
    contentType: string,
    region: string,
  ): Promise<void> {
    const host = `${region}${STORAGE_HOST_SUFFIX}`;
    const endpoint = `https://${host}/${bucket}/${key}`;

    const headers = await VoicemailAgent.s3SignV4Static(
      apiKey,
      "PUT",
      host,
      `/${bucket}/${key}`,
      region,
      { "Content-Type": contentType },
      data,
    );

    const resp = await fetch(endpoint, {
      method: "PUT",
      headers,
      body: data,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown error");
      throw new Error(`S3 PUT failed: ${resp.status} ${errText.slice(0, 200)}`);
    }
  }

  // ── AWS Signature V4 (minimal, S3-only) ────────────────────────────────

  private async s3SignV4(
    method: string,
    host: string,
    path: string,
    region: string,
    extraHeaders: Record<string, string>,
  ): Promise<HeadersInit> {
    return VoicemailAgent.s3SignV4Static(
      this.env.TELNYX_API_KEY,
      method,
      host,
      path,
      region,
      extraHeaders,
    );
  }

  static async s3SignV4Static(
    apiKey: string,
    method: string,
    host: string,
    path: string,
    region: string,
    extraHeaders: Record<string, string>,
    body?: ArrayBuffer,
  ): Promise<HeadersInit> {
    const service = "s3";
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const dateStamp = timestamp.slice(0, 8);

    // Hash the body (or empty string for GET)
    const bodyHash = body
      ? await sha256Hex(new Uint8Array(body))
      : "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // empty SHA-256

    // Canonical headers (must be sorted)
    const headers: Record<string, string> = {
      host,
      "x-amz-content-sha256": bodyHash,
      "x-amz-date": timestamp,
      ...extraHeaders,
    };

    const sortedHeaderKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedHeaderKeys
      .map((k) => `${k}:${headers[k].trim()}\n`)
      .join("");
    const signedHeaders = sortedHeaderKeys.join(";");

    // Canonical request
    const canonicalRequest = [
      method,
      path,
      "", // no query string
      canonicalHeaders,
      signedHeaders,
      bodyHash,
    ].join("\n");

    const canonicalHash = await sha256Hex(new TextEncoder().encode(canonicalRequest));

    // String to sign
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      timestamp,
      credentialScope,
      canonicalHash,
    ].join("\n");

    // Signing key
    const signingKey = await getSigningKey(apiKey, dateStamp, region, service);
    const signature = await hmacHex(signingKey, stringToSign);

    const authHeader = `AWS4-HMAC-SHA256 Credential=${apiKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const result: HeadersInit = {
      Authorization: authHeader,
      "x-amz-content-sha256": bodyHash,
      "x-amz-date": timestamp,
      ...extraHeaders,
    };

    return result;
  }
}

// ── Crypto helpers (Web Crypto API — available on Edge Compute) ──────────

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bufferToHex(hash);
}

async function hmacHex(key: ArrayBuffer, data: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bufferToHex(sig);
}

async function hmacBuffer(key: ArrayBuffer | string, data: string): Promise<ArrayBuffer> {
  const cryptoKey = typeof key === "string"
    ? await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    : key;
  return await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function getSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kSecret = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("AWS4" + secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const kDate = await hmacBuffer(kSecret, dateStamp);
  const kRegion = await hmacBuffer(kDate, region);
  const kService = await hmacBuffer(kRegion, service);
  return await hmacBuffer(kService, "aws4_request");
}

function bufferToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
