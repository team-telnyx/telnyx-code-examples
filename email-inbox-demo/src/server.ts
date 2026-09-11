import express from "express";
import { randomBytes } from "node:crypto";
import { InboxDb, defaultDbPath } from "./db.js";
import { dashboard } from "./dashboard.js";
import { DemoSeeder } from "./demoSeeder.js";
import { TelnyxEmailClient, payloadToMessageFields } from "./telnyxClient.js";
import { verifyTelnyxSignature } from "./webhookVerify.js";
import type { EmailReceivedPayload } from "./types.js";

/**
 * Email Inbox Demo — Express server.
 *
 * Routes:
 *   GET  /                              -> dashboard HTML
 *   GET  /api/inboxes                   -> list inboxes
 *   POST /api/inboxes                   -> create inbox (demo or telnyx)
 *   DELETE /api/inboxes/:id             -> delete inbox
 *   GET  /api/inboxes/:id/messages      -> list messages (filter by status)
 *   GET  /api/messages/:id              -> single message (body + headers)
 *   POST /api/messages/:id/read         -> mark as read
 *   POST /api/messages/:id/archive      -> archive
 *   POST /api/messages/:id/delete       -> delete (soft)
 *   GET  /api/events                    -> SSE: inbound + status changes
 *   POST /webhooks/email                -> email.received (Ed25519-verified)
 *   POST /api/demo/trigger              -> inject one simulated inbound (DEMO_MODE only)
 *   GET  /health                        -> liveness
 */
export async function main(): Promise<void> {
  const demoMode = (process.env.DEMO_MODE ?? "true") !== "false";
  const port = Number(process.env.PORT ?? 8788);
  const host = process.env.HOST ?? "127.0.0.1";
  const apiKey = process.env.TELNYX_API_KEY;
  const publicKey = process.env.TELNYX_PUBLIC_KEY;
  const publicBaseUrl = process.env.TELNYX_PUBLIC_BASE_URL;

  const db = new InboxDb(defaultDbPath());
  const seeder = new DemoSeeder(db, Number(process.env.DEMO_SEED_INTERVAL_MS ?? 15000));
  const telnyx = apiKey ? new TelnyxEmailClient(apiKey) : null;

  // Seed a demo inbox on first run so the UI isn't empty.
  if (demoMode && db.listInboxes().length === 0) {
    db.createInbox({
      id: "inbox_demo_support",
      email_address: "support@telnyx-demo.msgtelnyx.com",
      display_name: "Support",
      domain_id: "shared_inbound",
      source: "demo",
    });
  }
  if (demoMode) seeder.start();

  const app = express();

  // SSE bus
  type SseClient = { id: string; res: express.Response };
  const sseClients = new Set<SseClient>();
  function broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.res.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  // ── Dashboard ─────────────────────────────────────────────────────
  app.get("/", (_req, res) => {
    const hasCreds = Boolean(apiKey);
    res
      .type("text/html; charset=utf-8")
      .send(
        dashboard({
          demoMode,
          hasTelnyxCreds: hasCreds,
          apiBase: publicBaseUrl || `http://${host}:${port}`,
        }),
      );
  });

  // ── Inboxes ──────────────────────────────────────────────────────
  app.get("/api/inboxes", (_req, res) => {
    res.json(db.listInboxes());
  });

  app.post(
    "/api/inboxes",
    express.json({ limit: "256kb" }),
    async (req, res) => {
      const { username, domain, displayName } = req.body ?? {};
      if (!username || !domain) {
        return res.status(400).json({ error: "username and domain are required" });
      }
      if (telnyx && !demoMode) {
        try {
          const created = await telnyx.createInbox({ domain, username, displayName });
          const row = db.createInbox({
            id: `inbox_${created.id}`,
            email_address: created.email_address,
            display_name: displayName ?? null,
            domain_id: created.domain_id,
            source: "telnyx",
          });
          broadcast("inbox_created", { inbox: row });
          return res.json(row);
        } catch (err) {
          return res.status(502).json({ error: String((err as Error).message ?? err) });
        }
      }
      const id = `inbox_demo_${randomBytes(4).toString("hex")}`;
      const email = `${username}@${domain}.msgtelnyx.com`;
      const row = db.createInbox({
        id,
        email_address: email,
        display_name: displayName ?? null,
        domain_id: domain,
        source: "demo",
      });
      broadcast("inbox_created", { inbox: row });
      res.json(row);
    },
  );

  app.delete("/api/inboxes/:id", (req, res) => {
    db.deleteInbox(req.params.id);
    res.status(204).end();
  });

  // ── Messages ──────────────────────────────────────────────────────
  app.get("/api/inboxes/:id/messages", (req, res) => {
    const status = req.query.status && req.query.status !== "all" ? String(req.query.status) : undefined;
    res.json(db.listMessages(req.params.id, { status }));
  });

  app.get("/api/messages/:id", (req, res) => {
    const msg = db.getMessage(req.params.id);
    if (!msg) return res.status(404).json({ error: "not found" });
    res.json(msg);
  });

  app.post("/api/messages/:id/read", (req, res) => {
    db.setMessageStatus(req.params.id, "read");
    broadcast("message_status", { id: req.params.id, status: "read" });
    res.json({ ok: true });
  });

  app.post("/api/messages/:id/archive", (req, res) => {
    db.setMessageStatus(req.params.id, "archived");
    broadcast("message_status", { id: req.params.id, status: "archived" });
    res.json({ ok: true });
  });

  app.post("/api/messages/:id/delete", (req, res) => {
    db.setMessageStatus(req.params.id, "deleted");
    broadcast("message_status", { id: req.params.id, status: "deleted" });
    res.json({ ok: true });
  });

  // ── SSE ───────────────────────────────────────────────────────────
  app.get("/api/events", (_req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders?.();
    const client: SseClient = { id: randomBytes(8).toString("hex"), res };
    sseClients.add(client);
    res.write(`event: hello\ndata: ${JSON.stringify({ id: client.id, demoMode })}\n\n`);
    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(client);
      }
    }, 15000);
    heartbeat.unref?.();
    _req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(client);
    });
  });

  // ── Telnyx webhook receiver (raw body for Ed25519 verify) ─────────
  app.post(
    "/webhooks/email",
    express.raw({ type: "*/*", limit: "2mb" }),
    (req, res) => {
      const sig = req.header("telnyx-signature-ed25519");
      const ts = req.header("telnyx-timestamp");
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
      const verification = verifyTelnyxSignature({
        rawBody,
        signature: sig,
        timestamp: ts,
        publicKeyPem: publicKey,
      });
      if (!verification.ok && !demoMode) {
        return res.status(401).json({ error: "invalid signature", reason: verification.reason });
      }
      let payload: EmailReceivedPayload;
      try {
        payload = JSON.parse(rawBody.toString("utf8") || "{}");
      } catch {
        return res.status(400).json({ error: "invalid json" });
      }
      const p = payload.data?.payload ?? {};
      const inboxId = p.inbox_id;
      if (!inboxId) return res.status(400).json({ error: "missing inbox_id in payload" });
      const inbox = db.getInbox(inboxId);
      if (!inbox) return res.status(404).json({ error: "unknown inbox" });

      const fields = payloadToMessageFields(payload, inboxId);
      const id = `msg_${randomBytes(6).toString("hex")}`;
      const message = db.insertMessage({
        id,
        ...fields,
        status: "received",
        read_at: null,
        received_at: Date.now(),
      });
      db.appendEvent({
        inbox_id: inboxId,
        message_id: id,
        kind: "email.received",
        detail: "Verified Telnyx webhook",
        ts: Date.now(),
      });
      broadcast("message_received", {
        id,
        inbox_id: inboxId,
        from_address: message.from_address,
        from_name: message.from_name,
        subject: message.subject,
      });
      res.status(202).json({ ok: true, id });
    },
  );

  // ── Demo trigger ──────────────────────────────────────────────────
  app.post(
    "/api/demo/trigger",
    express.json({ limit: "256kb" }),
    (req, res) => {
      if (!demoMode) return res.status(403).json({ error: "demo mode disabled" });
      const inboxId = req.body?.inbox_id;
      if (!inboxId) return res.status(400).json({ error: "inbox_id required" });
      const id = seeder.triggerNow(inboxId);
      if (!id) return res.status(404).json({ error: "inbox not found" });
      const message = db.getMessage(id)!;
      broadcast("message_received", {
        id,
        inbox_id: inboxId,
        from_address: message.from_address,
        from_name: message.from_name,
        subject: message.subject,
      });
      res.json({ ok: true, id });
    },
  );

  // ── Health ────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      demoMode,
      hasTelnyxCreds: Boolean(apiKey),
      inboxes: db.listInboxes().length,
    });
  });

  // Start
  const server = app.listen(port, host, () => {
    const mode = demoMode ? "DEMO" : "LIVE";
    console.log(`Email Inbox: http://${host}:${port} (${mode} mode)`);
    if (!demoMode && publicBaseUrl) {
      console.log(`Webhook URL: ${publicBaseUrl}/webhooks/email`);
    }
  });
  server.on("error", (err) => {
    console.error("Server error:", err);
    process.exit(1);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
