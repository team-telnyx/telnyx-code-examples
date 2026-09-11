import { test } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InboxDb } from "../src/db.js";
import { DemoSeeder } from "../src/demoSeeder.js";
import { payloadToMessageFields } from "../src/telnyxClient.js";
import { verifyTelnyxSignature } from "../src/webhookVerify.js";

function tmpDb(): InboxDb {
  const dir = mkdtempSync(join(tmpdir(), "inbox-test-"));
  const path = join(dir, "test.sqlite");
  const db = new InboxDb(path);
  return db;
}

test("db creates inbox and message, updates status", () => {
  const db = tmpDb();
  const inbox = db.createInbox({
    id: "inbox_test",
    email_address: "test@example.com",
    domain_id: "shared_inbound",
    source: "demo",
  });
  assert.equal(inbox.email_address, "test@example.com");
  assert.equal(inbox.source, "demo");

  const msg = db.insertMessage({
    id: "msg_1",
    inbox_id: inbox.id,
    telnyx_id: null,
    thread_id: null,
    from_address: "sender@example.com",
    from_name: "Sender",
    to_addresses: "test@example.com",
    cc_addresses: null,
    subject: "Hello",
    preview: "Hi there",
    body_html: "<p>Hi there</p>",
    body_text: "Hi there",
    headers_json: null,
    attachments_json: null,
    status: "received",
    received_at: Date.now(),
  });
  assert.equal(msg.status, "received");
  db.setMessageStatus("msg_1", "read");
  const after = db.getMessage("msg_1");
  assert.equal(after?.status, "read");
  assert.ok(after?.read_at, "read_at should be set");
  db.close();
});

test("demo seeder synthesizes a realistic inbound message", async () => {
  const db = tmpDb();
  db.createInbox({
    id: "inbox_demo",
    email_address: "demo@example.com",
    domain_id: "shared_inbound",
    source: "demo",
  });
  const seeder = new DemoSeeder(db, 60_000); // don't fire on interval
  const id = seeder.triggerNow("inbox_demo");
  assert.ok(id, "seeder should return a message id");
  const msg = db.getMessage(id!);
  assert.ok(msg);
  assert.ok(msg!.from_address.includes("@"));
  assert.ok(msg!.subject && msg!.subject.length > 0);
  assert.ok(msg!.body_text && msg!.body_text.length > 0);
  assert.equal(msg!.status, "received");
  // Body HTML should be present and include the subject
  assert.ok(msg!.body_html && msg!.body_html.includes("<p"));
  db.close();
});

test("payloadToMessageFields maps Telnyx webhook to row fields", () => {
  const payload = {
    data: {
      event_type: "email.received",
      payload: {
        message_id: "abc-123",
        inbox_id: "inbox_test",
        from: { email: "alice@example.com", name: "Alice" },
        to: [{ email: "bob@example.com" }],
        subject: "Test",
        text: "Hello bob",
        html: "<p>Hello bob</p>",
        thread_id: "t-1",
      },
    },
  };
  const fields = payloadToMessageFields(payload as any, "inbox_test");
  assert.equal(fields.from_address, "alice@example.com");
  assert.equal(fields.from_name, "Alice");
  assert.equal(fields.subject, "Test");
  assert.equal(fields.body_text, "Hello bob");
  assert.equal(fields.thread_id, "t-1");
  assert.equal(fields.telnyx_id, "abc-123");
});

test("Ed25519 signature verification accepts valid signature, rejects tampered body", () => {
  const { publicKey, secretKey } = nacl.sign.keyPair();
  const ts = String(Math.floor(Date.now() / 1000));
  const body = Buffer.from(JSON.stringify({ data: { event_type: "email.received" } }));
  const message = Buffer.concat([Buffer.from(`${ts}.`), body]);
  const sig = nacl.sign.detached(message, secretKey);
  const hex = Buffer.from(sig).toString("hex");
  const pem = Buffer.from(publicKey).toString("base64");

  const ok = verifyTelnyxSignature({
    rawBody: body,
    signature: hex,
    timestamp: ts,
    publicKeyPem: pem,
  });
  assert.deepEqual(ok, { ok: true });

  // Tamper the body — signature should fail
  const tampered = verifyTelnyxSignature({
    rawBody: Buffer.from("tampered"),
    signature: hex,
    timestamp: ts,
    publicKeyPem: pem,
  });
  assert.equal(tampered.ok, false);

  // Stale timestamp — reject
  const stale = String(Math.floor(Date.now() / 1000) - 600);
  const staleMsg = Buffer.concat([Buffer.from(`${stale}.`), body]);
  const staleSig = Buffer.from(nacl.sign.detached(staleMsg, secretKey)).toString("hex");
  const staleResult = verifyTelnyxSignature({
    rawBody: body,
    signature: staleSig,
    timestamp: stale,
    publicKeyPem: pem,
    toleranceSeconds: 60,
  });
  assert.equal(staleResult.ok, false);
});

test("Ed25519 verification with PEM-encoded public key", () => {
  const { publicKey, secretKey } = nacl.sign.keyPair();
  const ts = String(Math.floor(Date.now() / 1000));
  const body = Buffer.from('{"hello":"world"}');
  const message = Buffer.concat([Buffer.from(`${ts}.`), body]);
  const sig = Buffer.from(nacl.sign.detached(message, secretKey)).toString("hex");

  // Build a fake PEM block
  const b64 = Buffer.from(publicKey).toString("base64");
  const lines = b64.match(/.{1,64}/g) ?? [];
  const pem = `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;

  const ok = verifyTelnyxSignature({
    rawBody: body,
    signature: sig,
    timestamp: ts,
    publicKeyPem: pem,
  });
  assert.deepEqual(ok, { ok: true });
});
