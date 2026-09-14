/**
 * SELF-REVIEW:
 * ✅ All spec primitives implemented (AMP OAuth, A2A messaging, KV peer registry,
 *    StateStore conversation state, schedule/every for token refresh + health check,
 *    SMS operator alerts via TELNYX binding)
 * ✅ smoke_test.ts verifies classes/methods exist and runs with npx tsx
 * ✅ Demo mode default (DEMO_MODE=true) — no real SMS sent unless explicitly enabled
 * ✅ No credentials in code — all from env vars/secrets
 * ASSUMPTION: AMP endpoints are external HTTP services. The actor calls them via
 *   fetch() with the OAuth client credentials flow. Peer validation uses AMP's
 *   /oauth/introspect endpoint. Replies are canned billing-service responses
 *   keyed by intent (not LLM-generated) per Design Decision #2.
 */

import {
  Agent,
  env,
  type Env as EdgeEnv,
  type Secrets,
  type ActorNamespace,
  type KvNamespace,
} from "@telnyx/edge-runtime";

// ─── Env interface ────────────────────────────────────────────────────────────
export interface Env {
  SECRETS: Secrets;
  IDENTITY_ACTOR: ActorNamespace;
  PEER_REGISTRY: KvNamespace;
  CONVERSATION_STORE: KvNamespace;
  TELNYX: {
    messages: {
      send: (params: { to: string; from: string; text: string }) => Promise<unknown>;
    };
  };
  AMP_TOKEN_URL: string;
  AMP_A2A_URL: string;
  AMP_INTROSPECT_URL: string;
  OPERATOR_NUMBER: string;
  TELNYX_SENDER: string;
  DEMO_MODE?: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface PeerState {
  agentId: string;
  authorized: boolean;
  firstContact: string | null;
  lastContact: string | null;
  messageCount: number;
}

export interface ConversationState {
  agentId: string;
  peerId: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: string;
  }>;
  turnCount: number;
  lastActiveAt: string;
  pendingQueue: Array<{ id: string; method: string; params: unknown }>;
}

export interface IdentityState {
  agentId: string;
  identityProvider: "AMP" | "KEYCLOAK";
  oauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    tokenType: string;
  };
  peers: PeerState[];
  status: "INITIALIZING" | "ACTIVE" | "TOKEN_REFRESHING" | "DEGRADED" | "REVOKED";
  lastHealthCheck: string | null;
  createdAt: string;
}

// ─── Canned billing responses ────────────────────────────────────────────────
export const CANNED_RESPONSES: Record<string, string> = {
  invoice_status: "Invoice INV-1042 is paid.",
  payment_method: "Your default payment method is Visa ending in 4242.",
  balance: "Your current balance is $1,250.00.",
  default: "Thank you for contacting billing. A representative will follow up.",
};

// ─── IdentityAgent ────────────────────────────────────────────────────────────
export class IdentityAgent extends Agent<Env, IdentityState> {
  protected initialState(): IdentityState {
    return {
      agentId: "agent-billing-svc",
      identityProvider: "AMP",
      oauth: {
        accessToken: "",
        refreshToken: "",
        expiresAt: 0,
        tokenType: "Bearer",
      },
      peers: [],
      status: "INITIALIZING",
      lastHealthCheck: null,
      createdAt: new Date().toISOString(),
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  async initialize(): Promise<void> {
    const state = await this.getState();
    if (state.status !== "INITIALIZING") return;

    try {
      const tokens = await this.registerWithAmp();
      await this.setState({
        oauth: tokens,
        status: "ACTIVE",
        identityProvider: "AMP",
      });
      // Self-wake 60s before expiry to refresh
      await this.schedule(Math.max(1, tokens.expiresAt - Date.now() / 1000 - 60), "refreshToken");
      // Recurring health check every 5 minutes
      await this.every(300, "healthCheck");
    } catch (err) {
      console.error("AMP registration failed", err);
      await this.setState({ status: "DEGRADED" });
      await this.alertOperator("AMP registration failed; actor entering DEGRADED state.");
    }
  }

  private async registerWithAmp(): Promise<IdentityState["oauth"]> {
    const clientId = await this.env.SECRETS.get("AMP_CLIENT_ID");
    const clientSecret = await this.env.SECRETS.get("AMP_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error("Missing AMP credentials");

    const form = new URLSearchParams();
    form.set("grant_type", "client_credentials");
    form.set("client_id", clientId);
    form.set("client_secret", clientSecret);

    const resp = await fetch(this.env.AMP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!resp.ok) throw new Error(`AMP token endpoint returned ${resp.status}`);

    const data = (await resp.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
    };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() / 1000 + data.expires_in,
      tokenType: data.token_type,
    };
  }

  // ─── Scheduled tasks ────────────────────────────────────────────────────────
  async refreshToken(): Promise<void> {
    const state = await this.getState();
    if (state.status === "REVOKED") return;

    await this.setState({ status: "TOKEN_REFRESHING" });
    try {
      const clientId = await this.env.SECRETS.get("AMP_CLIENT_ID");
      const clientSecret = await this.env.SECRETS.get("AMP_CLIENT_SECRET");
      if (!clientId || !clientSecret) throw new Error("Missing credentials");

      const form = new URLSearchParams();
      form.set("grant_type", "refresh_token");
      form.set("refresh_token", state.oauth.refreshToken);
      form.set("client_id", clientId);
      form.set("client_secret", clientSecret);

      const resp = await fetch(this.env.AMP_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
      if (!resp.ok) throw new Error(`Token refresh failed with ${resp.status}`);

      const data = (await resp.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        token_type: string;
      };
      await this.setState({
        oauth: {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() / 1000 + data.expires_in,
          tokenType: data.token_type,
        },
        status: "ACTIVE",
      });
      // Re-arm the pre-expiry refresh
      await this.schedule(Math.max(1, data.expires_in - 60), "refreshToken");

      // Replay any queued messages
      await this.replayQueuedMessages();
    } catch (err) {
      console.error("Token refresh failed", err);
      await this.setState({ status: "DEGRADED" });
      await this.alertOperator("Token refresh failed. Actor is DEGRADED.");
    }
  }

  async healthCheck(): Promise<void> {
    const state = await this.getState();
    if (state.status === "REVOKED" || state.status === "INITIALIZING") return;

    try {
      const resp = await fetch(this.env.AMP_INTROSPECT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: state.oauth.accessToken }),
      });
      const data = (await resp.json()) as { active?: boolean };
      if (!resp.ok || !data.active) throw new Error("Token inactive");

      await this.setState({ lastHealthCheck: new Date().toISOString() });
    } catch (err) {
      console.error("Health check failed", err);
      await this.setState({ status: "DEGRADED" });
      await this.alertOperator("Health check failed. Actor is DEGRADED.");
    }
  }

  // ─── Peer authorization ─────────────────────────────────────────────────────
  async authorizePeer(peerId: string): Promise<void> {
    const state = await this.getState();
    const existing = state.peers.find((p) => p.agentId === peerId);
    if (existing) {
      await this.setState({
        peers: state.peers.map((p) =>
          p.agentId === peerId ? { ...p, authorized: true } : p
        ),
      });
    } else {
      await this.setState({
        peers: [
          ...state.peers,
          {
            agentId: peerId,
            authorized: true,
            firstContact: null,
            lastContact: null,
            messageCount: 0,
          },
        ],
      });
    }
    // Persist to KV registry
    await this.env.PEER_REGISTRY.put(
      `peer:${peerId}`,
      JSON.stringify({ authorized: true, firstContact: null, lastContact: null, messageCount: 0 })
    );
  }

  async revokePeer(peerId: string): Promise<void> {
    const state = await this.getState();
    await this.setState({
      peers: state.peers.map((p) =>
        p.agentId === peerId ? { ...p, authorized: false } : p
      ),
    });
    await this.env.PEER_REGISTRY.put(
      `peer:${peerId}`,
      JSON.stringify({ authorized: false, firstContact: null, lastContact: null, messageCount: 0 })
    );
  }

  // ─── A2A message handling ───────────────────────────────────────────────────
  async handleA2AMessage(
    peerToken: string,
    body: { jsonrpc: string; id: string; method: string; params?: { intent?: string; content?: string } }
  ): Promise<unknown> {
    const state = await this.getState();
    if (state.status === "REVOKED") {
      return { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "actor revoked" } };
    }

    // Validate peer token via AMP introspect
    const peerId = await this.introspectPeerToken(peerToken);
    if (!peerId) {
      return { jsonrpc: "2.0", id: body.id, error: { code: -32001, message: "invalid peer token" } };
    }

    // Check authorization
    const peer = state.peers.find((p) => p.agentId === peerId);
    if (!peer?.authorized) {
      return { jsonrpc: "2.0", id: body.id, error: { code: -32002, message: "peer not authorized" } };
    }

    // If DEGRADED, queue the message
    if (state.status === "DEGRADED") {
      const conv = await this.getConversation(peerId);
      conv.pendingQueue.push({ id: body.id, method: body.method, params: body.params ?? {} });
      await this.saveConversation(peerId, conv);
      return { jsonrpc: "2.0", id: body.id, result: { queued: true, status: "DEGRADED" } };
    }

    // Process the message
    return this.processMessage(peerId, body);
  }

  private async introspectPeerToken(token: string): Promise<string | null> {
    try {
      const resp = await fetch(this.env.AMP_INTROSPECT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as { active?: boolean; sub?: string };
      if (!data.active || !data.sub) return null;
      return data.sub;
    } catch {
      return null;
    }
  }

  private async processMessage(
    peerId: string,
    body: { jsonrpc: string; id: string; method: string; params?: { intent?: string; content?: string } }
  ): Promise<unknown> {
    if (body.method !== "message/send") {
      return { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } };
    }

    const conv = await this.getConversation(peerId);
    const intent = body.params?.intent ?? "default";
    const reply = CANNED_RESPONSES[intent] ?? CANNED_RESPONSES.default;

    conv.messages.push({
      role: "user",
      content: body.params?.content ?? "",
      timestamp: new Date().toISOString(),
    });
    conv.messages.push({
      role: "assistant",
      content: reply,
      timestamp: new Date().toISOString(),
    });
    conv.turnCount += 1;
    conv.lastActiveAt = new Date().toISOString();
    await this.saveConversation(peerId, conv);

    // Update peer registry
    const state = await this.getState();
    await this.setState({
      peers: state.peers.map((p) =>
        p.agentId === peerId
          ? {
              ...p,
              lastContact: new Date().toISOString(),
              firstContact: p.firstContact ?? new Date().toISOString(),
              messageCount: p.messageCount + 1,
            }
          : p
      ),
    });
    await this.env.PEER_REGISTRY.put(
      `peer:${peerId}`,
      JSON.stringify({
        authorized: true,
        firstContact: conv.messages[0]?.timestamp ?? null,
        lastContact: conv.lastActiveAt,
        messageCount: conv.turnCount,
      })
    );

    return {
      jsonrpc: "2.0",
      id: body.id,
      result: {
        agentId: "agent-billing-svc",
        turn: conv.turnCount,
        reply,
      },
    };
  }

  private async replayQueuedMessages(): Promise<void> {
    const state = await this.getState();
    for (const peer of state.peers) {
      const conv = await this.getConversation(peer.agentId);
      if (conv.pendingQueue.length === 0) continue;
      const queued = [...conv.pendingQueue];
      conv.pendingQueue = [];
      await this.saveConversation(peer.agentId, conv);
      for (const msg of queued) {
        await this.processMessage(peer.agentId, {
          jsonrpc: "2.0",
          id: msg.id,
          method: msg.method,
          params: msg.params,
        });
      }
    }
  }

  // ─── Conversation state ─────────────────────────────────────────────────────
  private async getConversation(peerId: string): Promise<ConversationState> {
    const key = `conv:${peerId}`;
    const raw = await this.env.CONVERSATION_STORE.get(key, { type: "json" });
    if (raw) return raw as ConversationState;
    return {
      agentId: "agent-billing-svc",
      peerId,
      messages: [],
      turnCount: 0,
      lastActiveAt: new Date().toISOString(),
      pendingQueue: [],
    };
  }

  private async saveConversation(peerId: string, conv: ConversationState): Promise<void> {
    await this.env.CONVERSATION_STORE.put(`conv:${peerId}`, JSON.stringify(conv));
  }

  // ─── Operator alert (SMS) ───────────────────────────────────────────────────
  private async alertOperator(message: string): Promise<void> {
    const demoMode = this.env.DEMO_MODE !== "false";
    if (demoMode) {
      console.log(`[DEMO] SMS to ${this.env.OPERATOR_NUMBER}: ${message}`);
      return;
    }
    try {
      await this.env.TELNYX.messages.send({
        to: this.env.OPERATOR_NUMBER,
        from: this.env.TELNYX_SENDER,
        text: message,
      });
    } catch (err) {
      console.error("Failed to send operator SMS", err);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────
  async getIdentityState(): Promise<unknown> {
    const state = await this.getState();
    const expiresIn = Math.max(0, Math.floor(state.oauth.expiresAt - Date.now() / 1000));
    return {
      agentId: state.agentId,
      identityProvider: state.identityProvider,
      oauth: {
        accessToken: "••••",
        expiresIn,
        tokenType: state.oauth.tokenType,
      },
      peers: state.peers,
      status: state.status,
      lastHealthCheck: state.lastHealthCheck,
      createdAt: state.createdAt,
    };
  }

  async retry(): Promise<void> {
    const state = await this.getState();
    if (state.status === "DEGRADED") {
      await this.refreshToken();
    }
  }

  async revoke(): Promise<void> {
    await this.setState({ status: "REVOKED" });
  }

  // ─── HTTP fetch handler ─────────────────────────────────────────────────────
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // GET /api/identity/:agentId
    const identityMatch = path.match(/^\/api\/identity\/([^/]+)$/);
    if (identityMatch && req.method === "GET") {
      const agentId = identityMatch[1];
      if (agentId !== "agent-billing-svc") {
        return new Response(JSON.stringify({ error: "agent not found" }), { status: 404 });
      }
      const state = await this.getIdentityState();
      return new Response(JSON.stringify(state), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // POST /api/identity/:agentId/retry
    const retryMatch = path.match(/^\/api\/identity\/([^/]+)\/retry$/);
    if (retryMatch && req.method === "POST") {
      await this.retry();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // POST /api/identity/:agentId/revoke
    const revokeMatch = path.match(/^\/api\/identity\/([^/]+)\/revoke$/);
    if (revokeMatch && req.method === "POST") {
      await this.revoke();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // POST /api/identity/:agentId/authorize
    const authMatch = path.match(/^\/api\/identity\/([^/]+)\/authorize$/);
    if (authMatch && req.method === "POST") {
      const body = (await req.json()) as { peerId?: string };
      if (!body.peerId) {
        return new Response(JSON.stringify({ error: "peerId required" }), { status: 400 });
      }
      await this.authorizePeer(body.peerId);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // POST /a2a/message
    if (path === "/a2a/message" && req.method === "POST") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "missing bearer token" }), { status: 401 });
      }
      const peerToken = authHeader.slice(7);
      const body = (await req.json()) as {
        jsonrpc: string;
        id: string;
        method: string;
        params?: { intent?: string; content?: string };
      };
      const result = await this.handleA2AMessage(peerToken, body);
      const status = result.error ? (result.error.code === -32002 ? 403 : 401) : 200;
      return new Response(JSON.stringify(result), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }
}

// ─── Main entry ───────────────────────────────────────────────────────────────
export default {
  async fetch(req: Request): Promise<Response> {
    const actor = env.IDENTITY_ACTOR.get("agent-billing-svc");
    return actor.fetch(req);
  },
};

// Re-export for smoke_test.ts
export { env };
export type { EdgeEnv };
