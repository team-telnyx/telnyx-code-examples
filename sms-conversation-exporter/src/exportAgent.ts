import { Agent } from "@telnyx/edge-runtime";

// ── State ────────────────────────────────────────────────────────────────
export interface ExportAgentState extends Record<string, unknown> {
  exportId: string;
  status: "pending" | "counting" | "exporting" | "uploading" | "notifying" | "done" | "error";
  totalMessages: number;
  exportedMessages: number;
  chunkIndex: number;
  totalChunks: number;
  uploadedChunks: string[];
  conversationFilter: string | null; // phone number filter, or null for all
  startedAt: number;
  completedAt: number;
  exportUrl: string;
  error: string;
}

// ── Env: [telnyx] binding + KV + Cloud Storage + SQL (actor-local) ───────
interface ExportAgentEnv {
  TELNYX: {
    messages: {
      send(m: { from: string; to: string; text: string }): Promise<unknown>;
    };
  };
  EXPORT_KV: KvNamespace;
  EXPORT_STORAGE: CloudStorageBucket;
  ALERT_PHONE: string;
  SENDER_PHONE: string;
  CHUNK_SIZE: string;
}

const CHUNK_SIZE_DEFAULT = 500;

// ── SQL schema ───────────────────────────────────────────────────────────
// The actor's local SQL DB stores simulated SMS conversation messages.
// In production, this could be synced from Telnyx Messaging webhooks.
interface MessageRow {
  id: number;
  from_number: string;
  to_number: string;
  body: string;
  direction: "inbound" | "outbound";
  timestamp: number;
  status: string;
}

/**
 * ExportAgent — one actor instance per export job.
 *
 * Pipeline (each stage queued for non-blocking execution):
 *   1. countMessages()  — count total messages matching the filter
 *   2. exportChunk()    — SELECT a chunk from SQL → JSON → upload to Cloud Storage
 *      (re-queues itself until all chunks are done)
 *   3. notifyComplete() — send SMS to ops via this.env.TELNYX.messages.send()
 */
export class ExportAgent extends Agent<ExportAgentEnv, ExportAgentState> {
  protected override initialState(): ExportAgentState {
    return {
      exportId: "",
      status: "pending",
      totalMessages: 0,
      exportedMessages: 0,
      chunkIndex: 0,
      totalChunks: 0,
      uploadedChunks: [],
      conversationFilter: null,
      startedAt: 0,
      completedAt: 0,
      exportUrl: "",
      error: "",
    };
  }

  /** Initialize the SQL DB with seed data if empty. */
  async initDb(): Promise<void> {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        from_number TEXT NOT NULL,
        to_number   TEXT NOT NULL,
        body        TEXT NOT NULL,
        direction   TEXT NOT NULL,
        timestamp   INTEGER NOT NULL,
        status      TEXT NOT NULL
      )`,
    );

    // Check if we already have data
    const countResult = this.ctx.storage.sql.exec("SELECT COUNT(*) as cnt FROM messages").toArray();
    const count = countResult.length > 0 ? (countResult[0] as Record<string, unknown>).cnt as number : 0;

    if (count === 0) {
      // Seed with sample conversation data
      const seedMessages: Omit<MessageRow, "id">[] = [
        { from_number: "+18005551234", to_number: "+18005559876", body: "Hey, did you deploy the new API endpoint?", direction: "outbound", timestamp: Date.now() - 7200000, status: "delivered" },
        { from_number: "+18005559876", to_number: "+18005551234", body: "Yes, it's live. Running tests now.", direction: "inbound", timestamp: Date.now() - 7140000, status: "received" },
        { from_number: "+18005551234", to_number: "+18005559876", body: "Great. Let me know if you see any errors.", direction: "outbound", timestamp: Date.now() - 7080000, status: "delivered" },
        { from_number: "+18005559876", to_number: "+18005551234", body: "All tests passing. Traffic looks normal.", direction: "inbound", timestamp: Date.now() - 7020000, status: "received" },
        { from_number: "+18005551234", to_number: "+18005559876", body: "Perfect. Pushing to production.", direction: "outbound", timestamp: Date.now() - 6960000, status: "delivered" },
        { from_number: "+18005559876", to_number: "+18005551234", body: "Wait, seeing a spike in 500 errors on /api/users", direction: "inbound", timestamp: Date.now() - 6900000, status: "received" },
        { from_number: "+18005551234", to_number: "+18005559876", body: "On it. Rolling back the deployment.", direction: "outbound", timestamp: Date.now() - 6840000, status: "delivered" },
        { from_number: "+18005559876", to_number: "+18005551234", body: "Rollback complete. Errors stopped.", direction: "inbound", timestamp: Date.now() - 6780000, status: "received" },
        { from_number: "+18005551234", to_number: "+18005559876", body: "Good catch. Adding a regression test for that.", direction: "outbound", timestamp: Date.now() - 6720000, status: "delivered" },
        { from_number: "+18005559876", to_number: "+18005551234", body: "I'll review the PR when it's ready.", direction: "inbound", timestamp: Date.now() - 6660000, status: "received" },
        { from_number: "+18005551234", to_number: "+18005559876", body: "PR is up. Link coming in the next message.", direction: "outbound", timestamp: Date.now() - 6600000, status: "delivered" },
        { from_number: "+18005551234", to_number: "+18005559876", body: "github.com/team-telnyx/api/pull/142 — ready for review", direction: "outbound", timestamp: Date.now() - 6540000, status: "delivered" },
        { from_number: "+18005559876", to_number: "+18005551234", body: "Reviewed and approved. Ship it.", direction: "inbound", timestamp: Date.now() - 6480000, status: "received" },
        { from_number: "+18005551234", to_number: "+18005559876", body: "Merging now. Thanks for the fast review!", direction: "outbound", timestamp: Date.now() - 6420000, status: "delivered" },
        { from_number: "+18005559876", to_number: "+18005551234", body: "No problem. Let's grab lunch later?", direction: "inbound", timestamp: Date.now() - 6360000, status: "received" },
        { from_number: "+18005551234", to_number: "+18005559876", body: "Sounds good. 12:30 at the usual spot?", direction: "outbound", timestamp: Date.now() - 6300000, status: "delivered" },
        { from_number: "+18005559876", to_number: "+18005551234", body: "See you there.", direction: "inbound", timestamp: Date.now() - 6240000, status: "received" },
      ];

      for (const msg of seedMessages) {
        this.ctx.storage.sql.exec(
          `INSERT INTO messages (from_number, to_number, body, direction, timestamp, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
          msg.from_number,
          msg.to_number,
          msg.body,
          msg.direction,
          msg.timestamp,
          msg.status,
        );
      }
    }
  }

  /** Entry point — kick off the export pipeline. */
  async start(params: {
    exportId: string;
    conversationFilter: string | null;
  }): Promise<void> {
    await this.setState({
      exportId: params.exportId,
      conversationFilter: params.conversationFilter,
      status: "counting",
      startedAt: Date.now(),
      uploadedChunks: [],
    });
    await this.queue("countMessages");
  }

  /** Stage 1: Count total messages matching the filter. */
  async countMessages(): Promise<void> {
    const state = await this.getState();
    try {
      await this.initDb();

      const chunkSize = parseInt(this.env.CHUNK_SIZE, 10) || CHUNK_SIZE_DEFAULT;

      let totalMessages: number;
      if (state.conversationFilter) {
        const result = this.ctx.storage.sql.exec(
          `SELECT COUNT(*) as cnt FROM messages
           WHERE from_number = ? OR to_number = ?`,
          state.conversationFilter,
          state.conversationFilter,
        ).toArray();
        totalMessages = result.length > 0 ? (result[0] as Record<string, unknown>).cnt as number : 0;
      } else {
        const result = this.ctx.storage.sql.exec("SELECT COUNT(*) as cnt FROM messages").toArray();
        totalMessages = result.length > 0 ? (result[0] as Record<string, unknown>).cnt as number : 0;
      }

      const totalChunks = Math.ceil(totalMessages / chunkSize);

      await this.setState({
        ...state,
        totalMessages,
        totalChunks,
        status: "exporting",
        chunkIndex: 0,
      });

      if (totalMessages === 0) {
        await this.setState({ ...state, status: "done", completedAt: Date.now() });
        return;
      }

      await this.queue("exportChunk");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.setState({ ...state, status: "error", error: `countMessages: ${msg}` });
    }
  }

  /** Stage 2: Export a single chunk — SQL SELECT → JSON → Cloud Storage upload. */
  async exportChunk(): Promise<void> {
    const state = await this.getState();
    try {
      const chunkSize = parseInt(this.env.CHUNK_SIZE, 10) || CHUNK_SIZE_DEFAULT;
      const offset = state.chunkIndex * chunkSize;

      // Select the chunk from SQL
      let rows: Record<string, unknown>[];
      if (state.conversationFilter) {
        rows = this.ctx.storage.sql.exec(
          `SELECT id, from_number, to_number, body, direction, timestamp, status
           FROM messages
           WHERE from_number = ? OR to_number = ?
           ORDER BY timestamp ASC
           LIMIT ? OFFSET ?`,
          state.conversationFilter,
          state.conversationFilter,
          chunkSize,
          offset,
        ).toArray();
      } else {
        rows = this.ctx.storage.sql.exec(
          `SELECT id, from_number, to_number, body, direction, timestamp, status
           FROM messages
           ORDER BY timestamp ASC
           LIMIT ? OFFSET ?`,
          chunkSize,
          offset,
        ).toArray();
      }

      // Build the JSON chunk object
      const chunkData = {
        exportId: state.exportId,
        chunkIndex: state.chunkIndex,
        totalChunks: state.totalChunks,
        totalMessages: state.totalMessages,
        chunkSize: rows.length,
        messages: rows,
        exportedAt: Date.now(),
      };

      const chunkJson = JSON.stringify(chunkData, null, 2);
      const chunkKey = `exports/${state.exportId}/chunk-${String(state.chunkIndex).padStart(4, "0")}.json`;

      // Upload to Cloud Storage
      await this.env.EXPORT_STORAGE.put(chunkKey, chunkJson, {
        contentType: "application/json",
      });

      const uploadedChunks = [...state.uploadedChunks, chunkKey];
      const exportedMessages = state.exportedMessages + rows.length;
      const nextChunkIndex = state.chunkIndex + 1;

      await this.setState({
        ...state,
        chunkIndex: nextChunkIndex,
        exportedMessages,
        uploadedChunks,
        status: nextChunkIndex >= state.totalChunks ? "uploading" : "exporting",
      });

      if (nextChunkIndex < state.totalChunks) {
        // More chunks to go — re-queue
        await this.queue("exportChunk");
      } else {
        // All chunks uploaded — write manifest and notify
        await this.queue("writeManifest");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.setState({ ...state, status: "error", error: `exportChunk: ${msg}` });
    }
  }

  /** Stage 3: Write a manifest file listing all chunks, then queue notification. */
  async writeManifest(): Promise<void> {
    const state = await this.getState();
    try {
      const manifest = {
        exportId: state.exportId,
        totalMessages: state.totalMessages,
        totalChunks: state.totalChunks,
        exportedMessages: state.exportedMessages,
        chunks: state.uploadedChunks,
        conversationFilter: state.conversationFilter,
        startedAt: state.startedAt,
        completedAt: Date.now(),
      };

      const manifestKey = `exports/${state.exportId}/manifest.json`;
      const manifestJson = JSON.stringify(manifest, null, 2);

      await this.env.EXPORT_STORAGE.put(manifestKey, manifestJson, {
        contentType: "application/json",
      });

      await this.setState({
        ...state,
        status: "notifying",
        exportUrl: manifestKey,
      });

      await this.queue("notifyComplete");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.setState({ ...state, status: "error", error: `writeManifest: ${msg}` });
    }
  }

  /** Stage 4: Send SMS notification (zero-credential binding). */
  async notifyComplete(): Promise<void> {
    const state = await this.getState();
    try {
      const smsText =
        `Export complete: ${state.exportedMessages} messages in ${state.uploadedChunks.length} chunk(s). ` +
        `Manifest at ${state.exportUrl}. ` +
        `Export ID: ${state.exportId}`;

      await this.env.TELNYX.messages.send({
        from: this.env.SENDER_PHONE,
        to: this.env.ALERT_PHONE,
        text: smsText,
      });

      await this.setState({
        ...state,
        status: "done",
        completedAt: Date.now(),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.setState({ ...state, status: "error", error: `notifyComplete: ${msg}` });
    }
  }

  /** Debug helper — return current agent state. */
  async getStatus(): Promise<ExportAgentState> {
    return await this.getState();
  }

  /** Get a summary of the export for the HTTP API. */
  async getSummary(): Promise<{
    exportId: string;
    status: string;
    totalMessages: number;
    exportedMessages: number;
    totalChunks: number;
    uploadedChunks: string[];
    exportUrl: string;
    startedAt: number;
    completedAt: number;
    progress: number;
  }> {
    const state = await this.getState();
    const progress = state.totalMessages > 0
      ? Math.round((state.exportedMessages / state.totalMessages) * 100)
      : 0;
    return {
      exportId: state.exportId,
      status: state.status,
      totalMessages: state.totalMessages,
      exportedMessages: state.exportedMessages,
      totalChunks: state.totalChunks,
      uploadedChunks: state.uploadedChunks,
      exportUrl: state.exportUrl,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      progress,
    };
  }

  /** Add a single message to the SQL DB (for the seed/simulate endpoint). */
  async addMessage(params: {
    fromNumber: string;
    toNumber: string;
    body: string;
    direction: "inbound" | "outbound";
  }): Promise<{ id: number }> {
    await this.initDb();
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (from_number, to_number, body, direction, timestamp, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      params.fromNumber,
      params.toNumber,
      params.body,
      params.direction,
      Date.now(),
      params.direction === "outbound" ? "delivered" : "received",
    );

    const result = this.ctx.storage.sql.exec("SELECT last_insert_rowid() as id").toArray();
    const id = result.length > 0 ? (result[0] as Record<string, unknown>).id as number : 0;
    return { id };
  }

  /** Get all messages (for the HTTP API). */
  async listMessages(limit = 50): Promise<MessageRow[]> {
    await this.initDb();
    return this.ctx.storage.sql.exec(
      `SELECT id, from_number, to_number, body, direction, timestamp, status
       FROM messages ORDER BY timestamp DESC LIMIT ?`,
      limit,
    ).toArray() as unknown[] as MessageRow[];
  }

  /** Get conversation count. */
  async getMessageCount(): Promise<number> {
    await this.initDb();
    const result = this.ctx.storage.sql.exec("SELECT COUNT(*) as cnt FROM messages").toArray();
    return result.length > 0 ? (result[0] as Record<string, unknown>).cnt as number : 0;
  }
}
