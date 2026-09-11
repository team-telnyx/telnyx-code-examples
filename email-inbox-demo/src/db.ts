import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { EventRow, InboxRow, MessageRow } from "./types.js";

/**
 * Local SQLite cache for the email-inbox-demo.
 *
 * We persist:
 *   - inboxes: every inbox the user has created (real or demo)
 *   - messages: every email.received event (real or demo-seeded)
 *   - events: per-message timeline (queued → received → read → archived)
 *
 * The dashboard reads from this cache; the real Telnyx API is only consulted
 * for inbox creation + initial sync.
 */
export class InboxDb {
  private db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inboxes (
        id              TEXT PRIMARY KEY,
        email_address   TEXT NOT NULL UNIQUE,
        display_name    TEXT,
        domain_id       TEXT NOT NULL,
        inbound_enabled INTEGER NOT NULL DEFAULT 1,
        status          TEXT NOT NULL DEFAULT 'active',
        source          TEXT NOT NULL DEFAULT 'demo',
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS inboxes_by_address ON inboxes(email_address);

      CREATE TABLE IF NOT EXISTS messages (
        id               TEXT PRIMARY KEY,
        inbox_id         TEXT NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
        telnyx_id        TEXT,
        thread_id        TEXT,
        from_address     TEXT NOT NULL,
        from_name        TEXT,
        to_addresses     TEXT NOT NULL,
        cc_addresses     TEXT,
        subject          TEXT,
        preview          TEXT,
        body_html        TEXT,
        body_text        TEXT,
        headers_json     TEXT,
        attachments_json TEXT,
        status           TEXT NOT NULL DEFAULT 'received',
        received_at      INTEGER NOT NULL,
        read_at          INTEGER
      );
      CREATE INDEX IF NOT EXISTS messages_by_inbox ON messages(inbox_id, received_at DESC);
      CREATE INDEX IF NOT EXISTS messages_by_status ON messages(status);

      CREATE TABLE IF NOT EXISTS events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        inbox_id   TEXT NOT NULL,
        message_id TEXT NOT NULL,
        kind       TEXT NOT NULL,
        detail     TEXT,
        ts         INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_by_message ON events(message_id, ts);
    `);
  }

  // ── Inboxes ───────────────────────────────────────────────────────────

  createInbox(input: {
    id: string;
    email_address: string;
    display_name?: string | null;
    domain_id: string;
    source: "demo" | "telnyx";
  }): InboxRow {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO inboxes (id, email_address, display_name, domain_id, inbound_enabled, status, source, created_at, updated_at)
         VALUES (@id, @email_address, @display_name, @domain_id, 1, 'active', @source, @created_at, @updated_at);`,
      )
      .run({
        id: input.id,
        email_address: input.email_address,
        display_name: input.display_name ?? null,
        domain_id: input.domain_id,
        source: input.source,
        created_at: now,
        updated_at: now,
      });
    return this.getInbox(input.id)!;
  }

  getInbox(id: string): InboxRow | null {
    return (this.db.prepare(`SELECT * FROM inboxes WHERE id = ?;`).get(id) as
      | InboxRow
      | undefined) ?? null;
  }

  getInboxByAddress(email: string): InboxRow | null {
    return (this.db
      .prepare(`SELECT * FROM inboxes WHERE email_address = ?;`)
      .get(email) as InboxRow | undefined) ?? null;
  }

  listInboxes(): InboxRow[] {
    return this.db
      .prepare(`SELECT * FROM inboxes ORDER BY created_at DESC;`)
      .all() as InboxRow[];
  }

  deleteInbox(id: string): void {
    this.db.prepare(`DELETE FROM inboxes WHERE id = ?;`).run(id);
  }

  // ── Messages ──────────────────────────────────────────────────────────

  insertMessage(m: Omit<MessageRow, "read_at"> & { read_at?: number | null }): MessageRow {
    this.db
      .prepare(
        `INSERT INTO messages (id, inbox_id, telnyx_id, thread_id, from_address, from_name, to_addresses, cc_addresses, subject, preview, body_html, body_text, headers_json, attachments_json, status, received_at, read_at)
         VALUES (@id, @inbox_id, @telnyx_id, @thread_id, @from_address, @from_name, @to_addresses, @cc_addresses, @subject, @preview, @body_html, @body_text, @headers_json, @attachments_json, @status, @received_at, @read_at);`,
      )
      .run({
        ...m,
        read_at: m.read_at ?? null,
      });
    return this.getMessage(m.id)!;
  }

  getMessage(id: string): MessageRow | null {
    return (this.db.prepare(`SELECT * FROM messages WHERE id = ?;`).get(id) as
      | MessageRow
      | undefined) ?? null;
  }

  listMessages(inboxId: string, opts: { status?: string; limit?: number } = {}): MessageRow[] {
    const limit = opts.limit ?? 200;
    if (opts.status) {
      return this.db
        .prepare(
          `SELECT * FROM messages WHERE inbox_id = ? AND status = ? ORDER BY received_at DESC LIMIT ?;`,
        )
        .all(inboxId, opts.status, limit) as MessageRow[];
    }
    return this.db
      .prepare(
        `SELECT * FROM messages WHERE inbox_id = ? ORDER BY received_at DESC LIMIT ?;`,
      )
      .all(inboxId, limit) as MessageRow[];
  }

  setMessageStatus(id: string, status: MessageRow["status"]): void {
    const now = Date.now();
    if (status === "read") {
      this.db
        .prepare(`UPDATE messages SET status = ?, read_at = ? WHERE id = ?;`)
        .run(status, now, id);
    } else {
      this.db.prepare(`UPDATE messages SET status = ? WHERE id = ?;`).run(status, id);
    }
  }

  // ── Events ────────────────────────────────────────────────────────────

  appendEvent(ev: Omit<EventRow, "id">): EventRow {
    const result = this.db
      .prepare(
        `INSERT INTO events (inbox_id, message_id, kind, detail, ts) VALUES (?, ?, ?, ?, ?);`,
      )
      .run(ev.inbox_id, ev.message_id, ev.kind, ev.detail ?? null, ev.ts);
    const row = this.db
      .prepare(`SELECT * FROM events WHERE id = ?;`)
      .get(result.lastInsertRowid) as EventRow | undefined;
    return row!;
  }

  listEvents(messageId: string): EventRow[] {
    return this.db
      .prepare(`SELECT * FROM events WHERE message_id = ? ORDER BY ts ASC;`)
      .all(messageId) as EventRow[];
  }

  close(): void {
    this.db.close();
  }
}

export function defaultDbPath(): string {
  return resolve(process.env.EMAIL_INBOX_DB ?? ".data/inbox.sqlite");
}
