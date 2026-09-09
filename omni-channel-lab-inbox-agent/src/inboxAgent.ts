import { Agent } from "@telnyx/edge-runtime";
import type { SqlBindValue, SqlValue } from "@telnyx/edge-runtime";
import {
  type Channel,
  type ConversationFilter,
  type ConversationRow,
  type ConversationStatus,
  type ConversationView,
  type DocumentRow,
  type DocumentStatus,
  type FaxReceivedPayload,
  type InboxEnv,
  type InboxState,
  type MessageRow,
  type MessageView,
  ChannelDisabledError,
  ENABLED_CHANNELS,
  customerIdForChannel,
} from "./types";

const SCHEMA_VERSION = "v1";
const SYSTEM_PROMPT =
  "You are the Telnyx omni-channel inbox assistant. A customer is reaching out on a " +
  "Telnyx line. Keep replies short, warm, and useful. Ask one clarifying question at a " +
  "time if needed. Never mention APIs, webhooks, or implementation details. If you are " +
  "unsure, say so plainly. Your reply will be reviewed by a human operator before it " +
  "goes out, so draft it as if the customer will see it verbatim.";

/**
 * InboxAgent — one durable actor instance per customer.
 *
 * Storage:
 *  - this.ctx.storage.sql: per-actor SQLite (conversations, messages). Durable across deploys.
 *  - this.messages: Agent SDK MessageLog for the currently open conversation's LLM context.
 *  - this.setState/getState: actor-level summary (customer_id, enabled_channels, counts).
 *
 * Channel coverage (per PRD v1):
 *  - voice: live (inbound call → assistant → transcript → draft reply → operator approves → TTS)
 *  - email: stubbed (receiveEmail stores inbound + logs; sendEmail throws ChannelDisabledError)
 *  - sms/rcs/whatsapp: stubbed (receiveX stores inbound + logs; sendX throws ChannelDisabledError)
 *
 * The v1 stubs persist inbound messages so nothing is lost while we wait for the v1.1 / v2
 * channel enables. v1.1 flips email on once the Telnyx Email API is GA; v2 flips the
 * messaging channels on once the carrier registrations complete.
 */
export class InboxAgent extends Agent<InboxEnv, InboxState> {
  private schemaInitialized = false;

  protected override initialState(): InboxState {
    return {
      customer_id: "",
      open_conversation_id: null,
      enabled_channels: [...ENABLED_CHANNELS],
      voice_assistant_id: this.env.VOICE_ASSISTANT_ID ?? "",
      total_messages: 0,
      last_webhook_ts: null,
    };
  }

  // ── Schema ────────────────────────────────────────────────────────────

  /** Idempotent schema setup. Safe to call on every actor entry. */
  private async ensureSchema(): Promise<void> {
    if (this.schemaInitialized) return;
    const sql = this.ctx.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id            TEXT PRIMARY KEY,
        customer_id   TEXT NOT NULL,
        customer_label TEXT,
        channel       TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'open',
        agent_id      TEXT,
        assignee      TEXT,
        last_channel  TEXT NOT NULL,
        last_message_at INTEGER,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
    `);
    sql.exec(
      `CREATE INDEX IF NOT EXISTS conv_by_status ON conversations(status);`,
    );
    sql.exec(
      `CREATE INDEX IF NOT EXISTS conv_by_customer ON conversations(customer_id);`,
    );
    sql.exec(
      `CREATE INDEX IF NOT EXISTS conv_by_last_message ON conversations(last_message_at DESC);`,
    );
    sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id               TEXT PRIMARY KEY,
        conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        channel          TEXT NOT NULL,
        direction        TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'sent',
        sender_kind      TEXT NOT NULL,
        sender_op_id     TEXT,
        body             TEXT NOT NULL,
        subject          TEXT,
        message_id_hdr   TEXT,
        in_reply_to      TEXT,
        references_hdr   TEXT,
        call_control_id  TEXT,
        email_tracking_id TEXT,
        ts               INTEGER NOT NULL
      );
    `);
    sql.exec(
      `CREATE INDEX IF NOT EXISTS msg_by_conv ON messages(conversation_id, ts);`,
    );
    try {
      sql.exec(`ALTER TABLE messages ADD COLUMN email_tracking_id TEXT;`);
    } catch {
      // column already exists on actors created before this migration
    }
    sql.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id            TEXT PRIMARY KEY,
        fax_id        TEXT,
        reference     TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'received',
        fax_url       TEXT,
        file_name     TEXT,
        from_number   TEXT,
        to_number     TEXT,
        received_at   INTEGER NOT NULL,
        reviewed_at   INTEGER,
        accepted_at   INTEGER,
        deleted_at    INTEGER,
        metadata      TEXT,
        conversation_id TEXT,
        customer_id   TEXT,
        patient_email TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
    `);
    try {
      sql.exec(`ALTER TABLE documents ADD COLUMN customer_id TEXT;`);
    } catch {
      // column already exists
    }
    try {
      sql.exec(`ALTER TABLE documents ADD COLUMN patient_email TEXT;`);
    } catch {
      // column already exists
    }
    try {
      sql.exec(`ALTER TABLE documents ADD COLUMN email_sent_at INTEGER;`);
    } catch {
      // column already exists
    }
    try {
      sql.exec(`ALTER TABLE documents ADD COLUMN emailed_to TEXT;`);
    } catch {
      // column already exists
    }
    try {
      sql.exec(`ALTER TABLE documents ADD COLUMN opened_at INTEGER;`);
    } catch {
      // column already exists
    }
    sql.exec(
      `CREATE INDEX IF NOT EXISTS docs_by_status ON documents(status);`,
    );
    sql.exec(`
      CREATE TABLE IF NOT EXISTS appointments (
        id            TEXT PRIMARY KEY,
        patient_phone TEXT NOT NULL,
        patient_name  TEXT,
        patient_email TEXT,
        appointment_time TEXT,
        location      TEXT,
        status        TEXT NOT NULL DEFAULT 'booked',
        booked_at     INTEGER NOT NULL,
        completed_at  INTEGER,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
    `);
    this.schemaInitialized = true;
  }

  /** Generate a monotonic-ish id. newUniqueId() is broken in prod per the addressing docs. */
  private newId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }

  private sqlNow(): number {
    return Date.now();
  }

  // ── Conversation lifecycle ────────────────────────────────────────────

  /**
   * Find or create a conversation for an inbound message on a channel.
   * If the customer has an open conversation on a different channel, we still
   * create a new one per channel — cross-channel identity unification is v2
   * (see PRD Open Decisions #1).
   */
  async findOrCreateConversation(args: {
    channel: Channel;
    customerLabel?: string | null;
    agentId?: string | null;
    callControlId?: string | null;
  }): Promise<ConversationRow> {
    await this.ensureSchema();
    const sql = this.ctx.storage.sql;
    const state = await this.getState();
    const customerId = state.customer_id || "unknown";

    // Reuse the actor's currently open conversation if it matches the channel.
    if (state.open_conversation_id) {
      const existing = this.fetchOne<ConversationRow>(
        `SELECT * FROM conversations WHERE id = ?;`,
        state.open_conversation_id,
      );
      if (existing && existing.channel === args.channel && existing.status === "open") {
        return existing;
      }
    }

    // Otherwise look for an open conversation on the same channel.
    const byChannel = this.fetchOne<ConversationRow>(
      `SELECT * FROM conversations
       WHERE customer_id = ? AND channel = ? AND status = 'open'
       ORDER BY last_message_at DESC NULLS LAST LIMIT 1;`,
      customerId,
      args.channel,
    );
    if (byChannel) return byChannel;

    return this.createConversation(args);
  }

  async createConversation(args: {
    channel: Channel;
    customerLabel?: string | null;
    agentId?: string | null;
    callControlId?: string | null;
  }): Promise<ConversationRow> {
    await this.ensureSchema();
    const sql = this.ctx.storage.sql;
    const state = await this.getState();
    const customerId = state.customer_id || "unknown";
    const now = this.sqlNow();
    const id = this.newId("conv");
    sql.exec(
      `INSERT INTO conversations
         (id, customer_id, customer_label, channel, status, agent_id, assignee,
          last_channel, last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, NULL, ?, ?, ?, ?);`,
      id,
      customerId,
      args.customerLabel ?? null,
      args.channel,
      args.agentId ?? state.voice_assistant_id ?? null,
      args.channel,
      now,
      now,
      now,
    );
    const conv = this.fetchOne<ConversationRow>(
      `SELECT * FROM conversations WHERE id = ?;`,
      id,
    );
    if (!conv) throw new Error("failed to create conversation row");
    await this.setState({ ...state, open_conversation_id: id });
    return conv;
  }

  /** Update conversation's last-channel + last-message timestamp. */
  private async touchConversation(
    conversationId: string,
    channel: Channel,
  ): Promise<void> {
    const now = this.sqlNow();
    this.ctx.storage.sql.exec(
      `UPDATE conversations
         SET last_channel = ?, last_message_at = ?, updated_at = ?
       WHERE id = ?;`,
      channel,
      now,
      now,
      conversationId,
    );
  }

  async setConversationStatus(
    conversationId: string,
    status: ConversationStatus,
  ): Promise<void> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?;`,
      status,
      this.sqlNow(),
      conversationId,
    );
    const state = await this.getState();
    if (state.open_conversation_id === conversationId && status === "closed") {
      await this.setState({ ...state, open_conversation_id: null });
    }
  }

  async assignAgent(conversationId: string, agentId: string): Promise<void> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE conversations SET agent_id = ?, updated_at = ? WHERE id = ?;`,
      agentId,
      this.sqlNow(),
      conversationId,
    );
  }

  async assignOperator(conversationId: string, operatorId: string): Promise<void> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE conversations SET assignee = ?, updated_at = ? WHERE id = ?;`,
      operatorId,
      this.sqlNow(),
      conversationId,
    );
  }

  // ── Message storage ───────────────────────────────────────────────────

  /**
   * Store an inbound message and draft an agent reply.
   * Returns the stored inbound message row and the draft reply (status='draft').
   */
  async receiveInbound(args: {
    channel: Channel;
    body: string;
    subject?: string | null;
    customerLabel?: string | null;
    messageIdHdr?: string | null;
    inReplyTo?: string | null;
    referencesHdr?: string | null;
    callControlId?: string | null;
  }): Promise<{ inbound: MessageRow; draft: MessageRow | null }> {
    await this.ensureSchema();
    if (!ENABLED_CHANNELS.includes(args.channel)) {
      // v1 stubs still persist inbound messages so nothing is lost before v1.1/v2.
      console.warn(
        `[inbox] channel '${args.channel}' is stubbed in ${SCHEMA_VERSION}; ` +
          `inbound message stored but no auto-reply will be drafted`,
      );
    }

    const state = await this.getState();
    const conv = await this.findOrCreateConversation({
      channel: args.channel,
      customerLabel: args.customerLabel,
      callControlId: args.callControlId,
    });

    const now = this.sqlNow();
    const inboundId = this.newId("msg");
    this.ctx.storage.sql.exec(
      `INSERT INTO messages
         (id, conversation_id, channel, direction, status, sender_kind, sender_op_id,
          body, subject, message_id_hdr, in_reply_to, references_hdr, call_control_id, ts)
       VALUES (?, ?, ?, 'inbound', 'sent', 'customer', NULL, ?, ?, ?, ?, ?, ?, ?);`,
      inboundId,
      conv.id,
      args.channel,
      args.body,
      args.subject ?? null,
      args.messageIdHdr ?? null,
      args.inReplyTo ?? null,
      args.referencesHdr ?? null,
      args.callControlId ?? null,
      now,
    );
    await this.touchConversation(conv.id, args.channel);
    await this.setState({
      ...state,
      total_messages: state.total_messages + 1,
      last_webhook_ts: now,
    });

    const inbound = this.fetchOne<MessageRow>(
      `SELECT * FROM messages WHERE id = ?;`,
      inboundId,
    );
    if (!inbound) throw new Error("failed to store inbound message");

    // Append to LLM context only for voice in v1 (email/SMS/etc. drafts come in v1.1+).
    let draft: MessageRow | null = null;
    if (ENABLED_CHANNELS.includes(args.channel)) {
      draft = await this.draftReply(conv, args.body);
    }
    return { inbound, draft };
  }

  /**
   * Draft an agent reply and store it as status='draft'.
   * The operator reviews it in the admin UI before sendVoice/sendEmail/etc.
   */
  async draftReply(
    conversation: ConversationRow,
    userText: string,
  ): Promise<MessageRow> {
    await this.messages.add("user", userText);
    const history = await this.messages.toOpenAI();
    let reply = "";
    try {
      const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model: this.env.AI_MODEL ?? "zai-org/GLM-5.2",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
        max_tokens: 300,
        temperature: 0.5,
      });
      reply = completion.choices[0]?.message?.content?.trim() ?? "";
    } catch {
      reply =
        "Thanks for reaching out — I want to make sure I get this right. " +
        "Could you share a little more about what you need?";
    }
    if (!reply) reply = "Could you say a bit more about that?";
    await this.messages.add("assistant", reply);

    const now = this.sqlNow();
    const draftId = this.newId("msg");
    this.ctx.storage.sql.exec(
      `INSERT INTO messages
         (id, conversation_id, channel, direction, status, sender_kind, sender_op_id,
          body, subject, message_id_hdr, in_reply_to, references_hdr, call_control_id, ts)
       VALUES (?, ?, ?, 'outbound', 'draft', 'agent', NULL, ?, NULL, NULL, NULL, NULL, NULL, ?);`,
      draftId,
      conversation.id,
      conversation.channel,
      reply,
      now,
    );
    await this.touchConversation(conversation.id, conversation.channel);
    await this.setConversationStatus(conversation.id, "awaiting_human");

    const draft = this.fetchOne<MessageRow>(
      `SELECT * FROM messages WHERE id = ?;`,
      draftId,
    );
    if (!draft) throw new Error("failed to store draft reply");
    return draft;
  }

  /**
   * Edit a draft message body before approval.
   * Returns the updated row or null if the message is not a draft.
   */
  async editDraft(messageId: string, newBody: string): Promise<MessageRow | null> {
    await this.ensureSchema();
    const existing = this.fetchOne<MessageRow>(
      `SELECT * FROM messages WHERE id = ?;`,
      messageId,
    );
    if (!existing || existing.status !== "draft" || existing.direction !== "outbound") {
      return null;
    }
    this.ctx.storage.sql.exec(
      `UPDATE messages SET body = ?, ts = ? WHERE id = ?;`,
      newBody,
      this.sqlNow(),
      messageId,
    );
    return this.fetchOne<MessageRow>(`SELECT * FROM messages WHERE id = ?;`, messageId);
  }

  /**
   * Approve a draft and mark it ready to send. The fetch handler is responsible
   * for the actual channel send (TTS for voice, SMTP for email) because it has
   * the API key + call_control_id. This method flips the message to 'approved'
   * and returns the row so the handler can act on it.
   */
  async approveDraft(messageId: string): Promise<MessageRow | null> {
    await this.ensureSchema();
    const existing = this.fetchOne<MessageRow>(
      `SELECT * FROM messages WHERE id = ?;`,
      messageId,
    );
    if (!existing || existing.status !== "draft" || existing.direction !== "outbound") {
      return null;
    }
    this.ctx.storage.sql.exec(
      `UPDATE messages SET status = 'approved', ts = ? WHERE id = ?;`,
      this.sqlNow(),
      messageId,
    );
    return this.fetchOne<MessageRow>(`SELECT * FROM messages WHERE id = ?;`, messageId);
  }

  /**
   * Mark an approved message as sent (called by the fetch handler after a successful
   * channel send) and update the conversation's status.
   */
  async markSent(messageId: string): Promise<MessageRow | null> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE messages SET status = 'sent', ts = ? WHERE id = ?;`,
      this.sqlNow(),
      messageId,
    );
    const msg = this.fetchOne<MessageRow>(
      `SELECT * FROM messages WHERE id = ?;`,
      messageId,
    );
    if (msg) {
      await this.touchConversation(msg.conversation_id, msg.channel);
      await this.setConversationStatus(msg.conversation_id, "open");
    }
    return msg;
  }

  /**
   * Mark an approved message as failed (called by the fetch handler after a send error).
   */
  async markFailed(messageId: string): Promise<MessageRow | null> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE messages SET status = 'failed', ts = ? WHERE id = ?;`,
      this.sqlNow(),
      messageId,
    );
    return this.fetchOne<MessageRow>(`SELECT * FROM messages WHERE id = ?;`, messageId);
  }

  /**
   * Operator sent a reply directly (no draft step). The fetch handler has already
   * sent it on the channel; this records it in the inbox.
   */
  async recordHumanReply(args: {
    conversationId: string;
    channel: Channel;
    body: string;
    operatorId: string;
  }): Promise<MessageRow> {
    await this.ensureSchema();
    const now = this.sqlNow();
    const id = this.newId("msg");
    this.ctx.storage.sql.exec(
      `INSERT INTO messages
         (id, conversation_id, channel, direction, status, sender_kind, sender_op_id,
          body, subject, message_id_hdr, in_reply_to, references_hdr, call_control_id, ts)
       VALUES (?, ?, ?, 'outbound', 'sent', 'human', ?, ?, NULL, NULL, NULL, NULL, NULL, ?);`,
      id,
      args.conversationId,
      args.channel,
      args.operatorId,
      args.body,
      now,
    );
    await this.touchConversation(args.conversationId, args.channel);
    await this.setConversationStatus(args.conversationId, "open");
    const msg = this.fetchOne<MessageRow>(`SELECT * FROM messages WHERE id = ?;`, id);
    if (!msg) throw new Error("failed to record human reply");
    return msg;
  }

  // ── Voice-specific lifecycle ─────────────────────────────────────────

  /**
   * Called when the actor is first addressed for a voice call — ensures the
   * customer_id is set on the actor state so subsequent webhooks route correctly.
   */
  async bindVoiceCall(args: {
    callerNumber: string;
    callerLabel?: string | null;
    callControlId: string;
  }): Promise<ConversationRow> {
    const customerId = customerIdForChannel("voice", args.callerNumber);
    const state = await this.getState();
    if (!state.customer_id) {
      await this.setState({ ...state, customer_id: customerId });
    }
    return this.findOrCreateConversation({
      channel: "voice",
      customerLabel: args.callerLabel,
      callControlId: args.callControlId,
    });
  }

  /**
   * Take over a live voice call — pause the AI assistant. The fetch handler
   * stops transcription on the call leg; subsequent operator replies go via
   * recordHumanReply + speak.
   */
  async takeOverVoice(conversationId: string, operatorId: string): Promise<void> {
    await this.ensureSchema();
    await this.assignOperator(conversationId, operatorId);
    await this.setConversationStatus(conversationId, "awaiting_human");
  }

  /**
   * Release a voice call back to the AI assistant. The fetch handler resumes
   * transcription; subsequent caller utterances go through draftReply again.
   */
  async releaseVoice(conversationId: string): Promise<void> {
    await this.setConversationStatus(conversationId, "open");
  }

  // ── Channel send stubs ────────────────────────────────────────────────
  // The actor never calls the channel API directly — that's the fetch handler's
  // job because it has the API key + call_control_id. These methods exist so v1
  // can fail loudly on disabled channels and v2 can flip them on cleanly.
  // Email is enabled via the native Telnyx Email API in the fetch handler.

  async sendSMS(): Promise<never> {
    throw new ChannelDisabledError("sms", SCHEMA_VERSION);
  }
  async sendRCS(): Promise<never> {
    throw new ChannelDisabledError("rcs", SCHEMA_VERSION);
  }
  async sendWhatsApp(): Promise<never> {
    throw new ChannelDisabledError("whatsapp", SCHEMA_VERSION);
  }

  // ── Admin UI queries (callable from the fetch handler) ───────────────

  async listConversations(
    filter: ConversationFilter = {},
  ): Promise<ConversationView[]> {
    await this.ensureSchema();
    const where: string[] = [];
    const binds: SqlBindValue[] = [];
    if (filter.channel) {
      where.push("channel = ?");
      binds.push(filter.channel);
    }
    if (filter.status) {
      where.push("status = ?");
      binds.push(filter.status);
    }
    if (filter.assignee !== undefined) {
      if (filter.assignee === null) {
        where.push("assignee IS NULL");
      } else {
        where.push("assignee = ?");
        binds.push(filter.assignee);
      }
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.min(filter.limit ?? 100, 500);
    const offset = filter.offset ?? 0;
    const rows = this.fetchAll<ConversationRow>(
      `SELECT * FROM conversations ${whereSql}
       ORDER BY last_message_at DESC NULLS LAST LIMIT ? OFFSET ?;`,
      ...binds,
      limit,
      offset,
    );

    // Hydrate with the most recent message preview.
    return rows.map((conv) => {
      const last = this.fetchOne<MessageRow>(
        `SELECT * FROM messages WHERE conversation_id = ? ORDER BY ts DESC LIMIT 1;`,
        conv.id,
      );
      return {
        conversation: conv,
        last_message_preview: last ? last.body.slice(0, 140) : null,
        last_message_at: last ? last.ts : conv.last_message_at,
        unread: last ? last.direction === "inbound" && last.status !== "sent" : false,
      };
    });
  }

  async listMessages(conversationId: string): Promise<MessageView[]> {
    await this.ensureSchema();
    const rows = this.fetchAll<MessageRow>(
      `SELECT * FROM messages WHERE conversation_id = ? ORDER BY ts ASC;`,
      conversationId,
    );
    return rows.map((m) => ({
      message: m,
      sender_label:
        m.sender_kind === "agent"
          ? "Agent"
          : m.sender_kind === "human"
            ? `Operator ${m.sender_op_id ?? "?"}`
            : "Customer",
    }));
  }

  async getDebugState(): Promise<InboxState> {
    return await this.getState();
  }

  // ── Fax document intake (lab result workflow) ─────────────────────────

  /**
   * Store an incoming lab-result fax and create its inbox conversation.
   * The actor's customer_id must already be bound (set by the fetch handler
   * before calling this, since faxes have no caller number to key on).
   */
  async receiveFaxDocument(args: {
    faxId: string;
    reference: string;
    faxUrl: string | null;
    fileName: string | null;
    fromNumber: string | null;
    toNumber: string | null;
    pages: number | null;
  }): Promise<{ document: DocumentRow; conversation: ConversationRow }> {
    await this.ensureSchema();
    const now = Date.now();

    // Each fax is its own case: create a fresh conversation per document.
    const conv = await this.createConversation({
      channel: "fax" as Channel,
      customerLabel: args.fromNumber,
    });

    const id = this.newId("doc");
    const state = await this.getState();
    const actorCustomerId = state.customer_id || null;
    this.ctx.storage.sql.exec(
      `INSERT INTO documents
         (id, fax_id, reference, status, fax_url, file_name, from_number, to_number,
          received_at, metadata, conversation_id, customer_id, created_at, updated_at)
       VALUES (?, ?, ?, 'received', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      id,
      args.faxId,
      args.reference,
      args.faxUrl,
      args.fileName,
      args.fromNumber,
      args.toNumber,
      now,
      JSON.stringify({ pages: args.pages }),
      conv.id,
      actorCustomerId,
      now,
      now,
    );

    this.ctx.storage.sql.exec(
      `INSERT INTO messages
         (id, conversation_id, channel, direction, status, sender_kind, sender_op_id,
          body, subject, message_id_hdr, in_reply_to, references_hdr, call_control_id, ts)
       VALUES (?, ?, 'fax', 'inbound', 'sent', 'customer', NULL, ?, NULL, NULL, NULL, NULL, NULL, ?);`,
      this.newId("msg"),
      conv.id,
      `Fax received — reference ${args.reference} (${args.pages ?? "?"} pages)`,
      now,
    );
    await this.touchConversation(conv.id, "fax" as Channel);

    const document = this.fetchOne<DocumentRow>(
      `SELECT * FROM documents WHERE id = ?;`,
      id,
    );
    if (!document) throw new Error("failed to store document");
    return { document, conversation: conv };
  }

  async listDocuments(): Promise<DocumentRow[]> {
    await this.ensureSchema();
    return this.fetchAll<DocumentRow>(
      `SELECT * FROM documents ORDER BY received_at DESC LIMIT 200;`,
    );
  }

  async getDocumentByReference(reference: string): Promise<DocumentRow | null> {
    await this.ensureSchema();
    return this.fetchOne<DocumentRow>(
      `SELECT * FROM documents WHERE reference = ? ORDER BY received_at DESC LIMIT 1;`,
      reference,
    );
  }

  async findDocumentByReferenceSuffix(suffix: string): Promise<DocumentRow | null> {
    await this.ensureSchema();
    return this.fetchOne<DocumentRow>(
      `SELECT * FROM documents WHERE reference LIKE ? ORDER BY received_at DESC LIMIT 1;`,
      `%${suffix}`,
    );
  }

  async markDocumentReviewed(documentId: string): Promise<DocumentRow | null> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE documents SET status = 'reviewed', reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'received';`,
      Date.now(),
      Date.now(),
      documentId,
    );
    return this.fetchOne<DocumentRow>(`SELECT * FROM documents WHERE id = ?;`, documentId);
  }

  /**
   * Accept a document: flip status, record timestamps, null out the fax
   * content pointers. Deleting the fax from Telnyx is the fetch handler's
   * job (it has the API key) — call markFaxDeleted after DELETE succeeds.
   */
  async acceptDocument(documentId: string): Promise<DocumentRow | null> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE documents SET status = 'accepted', accepted_at = ?, updated_at = ? WHERE id = ?;`,
      Date.now(),
      Date.now(),
      documentId,
    );
    return this.fetchOne<DocumentRow>(`SELECT * FROM documents WHERE id = ?;`, documentId);
  }

  async rejectDocument(documentId: string): Promise<DocumentRow | null> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE documents SET status = 'rejected', accepted_at = ?, updated_at = ? WHERE id = ?;`,
      Date.now(),
      Date.now(),
      documentId,
    );
    return this.fetchOne<DocumentRow>(`SELECT * FROM documents WHERE id = ?;`, documentId);
  }

  /** Null out fax pointers after the DELETE /v2/faxes/{fax_id} call succeeds. */
  async markFaxDeleted(documentId: string): Promise<DocumentRow | null> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE documents SET fax_id = NULL, fax_url = NULL, deleted_at = ?, updated_at = ? WHERE id = ?;`,
      Date.now(),
      Date.now(),
      documentId,
    );
    return this.fetchOne<DocumentRow>(`SELECT * FROM documents WHERE id = ?;`, documentId);
  }

  /** Store the AI-drafted confirmation email as a draft message on the document's conversation. */
  async draftConfirmationEmail(
    documentId: string,
    emailBody: string,
  ): Promise<MessageRow | null> {
    await this.ensureSchema();
    const doc = this.fetchOne<DocumentRow>(`SELECT * FROM documents WHERE id = ?;`, documentId);
    if (!doc || !doc.conversation_id) return null;
    const now = Date.now();
    const id = this.newId("msg");
    this.ctx.storage.sql.exec(
      `INSERT INTO messages
         (id, conversation_id, channel, direction, status, sender_kind, sender_op_id,
          body, subject, message_id_hdr, in_reply_to, references_hdr, call_control_id, ts)
       VALUES (?, ?, 'email', 'outbound', 'draft', 'agent', NULL, ?, ?, NULL, NULL, NULL, NULL, ?);`,
      id,
      doc.conversation_id,
      emailBody,
      `Your lab document was received — ${doc.reference}`,
      now,
    );
    await this.touchConversation(doc.conversation_id, "email" as Channel);
    this.ctx.storage.sql.exec(
      `UPDATE documents SET status = 'followed_up', updated_at = ? WHERE id = ?;`,
      now,
      documentId,
    );
    return this.fetchOne<MessageRow>(`SELECT * FROM messages WHERE id = ?;`, id);
  }

  /** Look up a document by case reference — used by the AI for status questions. */
  async documentStatusForReference(
    reference: string,
  ): Promise<string | null> {
    const doc = await this.getDocumentByReference(reference);
    if (!doc) return null;
    const deleted = doc.deleted_at ? " (original fax deleted)" : "";
    return `Reference ${doc.reference}: status ${doc.status}, received ${new Date(
      doc.received_at,
    ).toISOString()}${deleted}`;
  }

  async attachEmailTrackingId(
    messageId: string,
    telnyxEmailId: string,
  ): Promise<void> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE messages SET email_tracking_id = ? WHERE id = ?;`,
      telnyxEmailId,
      messageId,
    );
  }

  async setPatientEmailByDocument(
    documentId: string,
    email: string,
  ): Promise<DocumentRow | null> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE documents SET patient_email = ?, updated_at = ? WHERE id = ?;`,
      email.toLowerCase().trim(),
      Date.now(),
      documentId,
    );
    return this.fetchOne<DocumentRow>(`SELECT * FROM documents WHERE id = ?;`, documentId);
  }

  async getPatientEmailByConversation(
    conversationId: string,
  ): Promise<string | null> {
    await this.ensureSchema();
    const row = this.fetchOne<{ patient_email: string | null }>(
      `SELECT patient_email FROM documents WHERE conversation_id = ? AND patient_email IS NOT NULL ORDER BY received_at DESC LIMIT 1;`,
      conversationId,
    );
    return row?.patient_email ?? null;
  }

  async getPatientEmailByDocument(documentId: string): Promise<string | null> {
    await this.ensureSchema();
    const row = this.fetchOne<{ patient_email: string | null }>(
      `SELECT patient_email FROM documents WHERE id = ?;`,
      documentId,
    );
    return row?.patient_email ?? null;
  }

  /** Record that results were emailed to the patient — drives the voice lookup answer. */
  async markResultsEmailed(
    documentId: string,
    emailedTo: string,
  ): Promise<DocumentRow | null> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE documents SET email_sent_at = ?, emailed_to = ?, status = 'followed_up', updated_at = ? WHERE id = ?;`,
      Date.now(),
      emailedTo.toLowerCase().trim(),
      Date.now(),
      documentId,
    );
    return this.fetchOne<DocumentRow>(`SELECT * FROM documents WHERE id = ?;`, documentId);
  }

  /** Record that the patient opened the results email (real via webhooks on a custom domain; simulated for demo). */
  async markResultsOpened(documentId: string): Promise<DocumentRow | null> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE documents SET opened_at = ?, updated_at = ? WHERE id = ?;`,
      Date.now(),
      Date.now(),
      documentId,
    );
    return this.fetchOne<DocumentRow>(`SELECT * FROM documents WHERE id = ?;`, documentId);
  }

  // ── Appointments + patient record ─────────────────────────────────────

  async bookAppointment(args: {
    patientPhone: string;
    patientName?: string | null;
    patientEmail?: string | null;
    appointmentTime: string;
    location: string;
  }): Promise<Record<string, SqlValue>> {
    await this.ensureSchema();
    const now = Date.now();
    const id = this.newId("appt");
    this.ctx.storage.sql.exec(
      `INSERT INTO appointments
         (id, patient_phone, patient_name, patient_email, appointment_time, location,
          status, booked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'booked', ?, ?, ?);`,
      id,
      args.patientPhone,
      args.patientName ?? null,
      args.patientEmail ?? null,
      args.appointmentTime,
      args.location,
      now,
      now,
      now,
    );
    const row = this.fetchOne<Record<string, SqlValue>>(
      `SELECT * FROM appointments WHERE id = ?;`,
      id,
    );
    if (!row) throw new Error("failed to book appointment");
    return row;
  }

  async getLatestAppointment(): Promise<Record<string, SqlValue> | null> {
    await this.ensureSchema();
    return this.fetchOne<Record<string, SqlValue>>(
      `SELECT * FROM appointments ORDER BY booked_at DESC LIMIT 1;`,
    );
  }

  async completeAppointment(appointmentId: string): Promise<Record<string, SqlValue> | null> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE appointments SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?;`,
      Date.now(),
      Date.now(),
      appointmentId,
    );
    return this.fetchOne<Record<string, SqlValue>>(
      `SELECT * FROM appointments WHERE id = ?;`,
      appointmentId,
    );
  }

  async listAppointments(): Promise<Record<string, SqlValue>[]> {
    await this.ensureSchema();
    return this.fetchAll<Record<string, SqlValue>>(
      `SELECT * FROM appointments ORDER BY booked_at DESC LIMIT 100;`,
    );
  }

  /** Demo reset: clear appointments, documents, conversations, and messages on this actor. */
  async resetDemoState(): Promise<void> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(`DELETE FROM messages;`);
    this.ctx.storage.sql.exec(`DELETE FROM documents;`);
    this.ctx.storage.sql.exec(`DELETE FROM appointments;`);
    this.ctx.storage.sql.exec(`DELETE FROM conversations;`);
    const state = await this.getState();
    await this.setState({ ...state, open_conversation_id: null, total_messages: 0 });
  }

  /**
   * Patient record for the voice lookup tool: latest appointment + lab docs +
   * whether results were emailed. Everything the AI may say, nothing clinical.
   */
  async getPatientRecord(): Promise<{
    patient_id: string;
    patient_email: string | null;
    appointment: Record<string, SqlValue> | null;
    lab_documents: Array<{
      reference: string;
      status: string;
      received_at: number;
      email_sent_at: number | null;
      emailed_to: string | null;
    }>;
  }> {
    await this.ensureSchema();
    const state = await this.getState();
    const appointment = await this.getLatestAppointment();
    const docs = this.fetchAll<{
      reference: string;
      status: string;
      received_at: number;
      email_sent_at: number | null;
      emailed_to: string | null;
    }>(
      `SELECT reference, status, received_at, email_sent_at, emailed_to FROM documents ORDER BY received_at DESC LIMIT 20;`,
    );
    let patientEmail = state.customer_id || null;
    const withEmail = docs.find((d) => d.emailed_to);
    if (withEmail) patientEmail = withEmail.emailed_to;
    return {
      patient_id: state.customer_id,
      patient_email: patientEmail,
      appointment,
      lab_documents: docs,
    };
  }

  async getEmailTrackingId(messageId: string): Promise<string | null> {
    await this.ensureSchema();
    const row = this.fetchOne<{ email_tracking_id: string | null }>(
      `SELECT email_tracking_id FROM messages WHERE id = ?;`,
      messageId,
    );
    return row?.email_tracking_id ?? null;
  }

  async registerCustomer(customerId: string, channel: string): Promise<void> {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS customers (
        customer_id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );`,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO customers (customer_id, channel, first_seen, last_seen)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(customer_id) DO UPDATE SET last_seen = excluded.last_seen;`,
      customerId,
      channel,
      Date.now(),
      Date.now(),
    );
  }

  async listRegisteredCustomers(): Promise<
    Array<{ customer_id: string; channel: string; first_seen: number; last_seen: number }>
  > {
    await this.ensureSchema();
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS customers (
        customer_id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );`,
    );
    return this.fetchAll<{
      customer_id: string;
      channel: string;
      first_seen: number;
      last_seen: number;
    }>(`SELECT * FROM customers ORDER BY last_seen DESC LIMIT 500;`);
  }

  /**
   * Raw table dump for the /db admin viewer. Returns plain rows (no joins,
   * no hydration) so the operator can see exactly what's in the per-actor
   * SQLite. Read-only — no create/update/delete via this surface.
   */
  async dumpTable(args: {
    table: "conversations" | "messages";
    limit?: number;
    offset?: number;
    conversationId?: string;
  }): Promise<{ rows: Record<string, SqlValue>[]; total: number }> {
    await this.ensureSchema();
    const limit = Math.min(args.limit ?? 200, 1000);
    const offset = args.offset ?? 0;
    if (args.table === "conversations") {
      const rows = this.fetchAll<ConversationRow>(
        `SELECT * FROM conversations ORDER BY created_at DESC LIMIT ? OFFSET ?;`,
        limit,
        offset,
      );
      const countRow = this.fetchOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM conversations;`,
      );
      return { rows: rows as unknown as Record<string, SqlValue>[], total: countRow?.c ?? 0 };
    }
    if (args.conversationId) {
      const rows = this.fetchAll<MessageRow>(
        `SELECT * FROM messages WHERE conversation_id = ? ORDER BY ts ASC LIMIT ? OFFSET ?;`,
        args.conversationId,
        limit,
        offset,
      );
      const countRow = this.fetchOne<{ c: number }>(
        `SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?;`,
        args.conversationId,
      );
      return { rows: rows as unknown as Record<string, SqlValue>[], total: countRow?.c ?? 0 };
    }
    const rows = this.fetchAll<MessageRow>(
      `SELECT * FROM messages ORDER BY ts DESC LIMIT ? OFFSET ?;`,
      limit,
      offset,
    );
    const countRow = this.fetchOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM messages;`,
    );
    return { rows: rows as unknown as Record<string, SqlValue>[], total: countRow?.c ?? 0 };
  }

  // ── SQL helpers ───────────────────────────────────────────────────────
  // ctx.storage.sql.exec<T>(query, ...bindings: SqlBindValue[]) → SqlCursor<T>
  // The cursor is Iterable<T> and exposes toArray() to drain remaining rows.
  // Bindings are positional `?` placeholders, typed as SqlBindValue
  // (null | number | string | ArrayBuffer | boolean). We cast through
  // SqlBindValue at the helper boundary so callers pass plain TS values.

  private fetchOne<T extends Record<string, SqlValue>>(
    query: string,
    ...bindings: SqlBindValue[]
  ): T | null {
    const cursor = this.ctx.storage.sql.exec<T>(query, ...bindings);
    for (const row of cursor) {
      return row;
    }
    return null;
  }

  private fetchAll<T extends Record<string, SqlValue>>(
    query: string,
    ...bindings: SqlBindValue[]
  ): T[] {
    const cursor = this.ctx.storage.sql.exec<T>(query, ...bindings);
    const out: T[] = [];
    for (const row of cursor) {
      out.push(row);
    }
    return out;
  }
}
