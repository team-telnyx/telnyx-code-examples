import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nacl from "tweetnacl";
import {
  initSchema,
  listTenants,
  getTenant,
  checkRateLimit,
  resetRateLimit,
  type TenantConfigCtx,
} from "../src/tenantConfigLogic.js";
import {
  startCall,
  getCall,
  listCalls,
  hangup,
  activeCount,
  type TenantVoiceCtx,
} from "../src/tenantVoiceLogic.js";
import { verifyTelnyxSignature } from "../src/webhookVerify.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "mtvp-test-"));
}

/**
 * Mock of the Edge runtime's `ctx.storage.sql` shape, backed by better-sqlite3.
 * Routes SELECT to `.all()` and everything else (CREATE/INSERT/UPDATE) to
 * `.run()` — better-sqlite3 throws "This statement does not return data"
 * if you call `.all()` on an INSERT.
 */
function makeSql(db: Database.Database): {
  exec<T>(query: string, ...bindings: unknown[]): Iterable<T> & { toArray(): T[] };
} {
  return {
    exec<T>(query: string, ...bindings: unknown[]): Iterable<T> & { toArray(): T[] } {
      const isSelect = /^\s*(SELECT|PRAGMA)/i.test(query);
      const stmt = db.prepare(query);
      if (isSelect) {
        const cursor = stmt.all(...bindings) as T[];
        return {
          *[Symbol.iterator]() { for (const row of cursor) yield row; },
          toArray() { return cursor; },
        };
      }
      stmt.run(...bindings);
      return {
        *[Symbol.iterator]() {},
        toArray() { return []; },
      };
    },
  };
}

function makeConfigCtx(dbPath: string): TenantConfigCtx {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  const state: {
    seeded: boolean;
    rate_limits: { windows: Record<string, { window_start: number; count: number }> };
  } = { seeded: false, rate_limits: { windows: {} } };
  return {
    storage: { sql: makeSql(db) },
    async getState<T>() { return state as unknown as T; },
    async setState<T>(next: T) { Object.assign(state, next); },
  };
}

function makeVoiceCtx(dbPath: string): TenantVoiceCtx {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  return { storage: { sql: makeSql(db) } };
}

test("config: seeds two tenants on first init", async () => {
  const dir = tmpDir();
  try {
    const ctx = makeConfigCtx(join(dir, "config.sqlite"));
    await initSchema(ctx);
    const tenants = await listTenants(ctx);
    assert.equal(tenants.length, 2);
    const ids = tenants.map((t) => t.id).sort();
    assert.deepEqual(ids, ["tenant_a", "tenant_b"]);
    assert.equal(tenants[0].rate_limit_per_minute, 10);
    assert.equal(tenants[1].rate_limit_per_minute, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: init is idempotent", async () => {
  const dir = tmpDir();
  try {
    const ctx = makeConfigCtx(join(dir, "config.sqlite"));
    await initSchema(ctx);
    await initSchema(ctx);
    await initSchema(ctx);
    const tenants = await listTenants(ctx);
    assert.equal(tenants.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: get returns the right tenant", async () => {
  const dir = tmpDir();
  try {
    const ctx = makeConfigCtx(join(dir, "config.sqlite"));
    await initSchema(ctx);
    const tenant = await getTenant(ctx, "tenant_b");
    assert.ok(tenant);
    assert.equal(tenant.id, "tenant_b");
    assert.equal(tenant.rate_limit_per_minute, 5);
    const missing = await getTenant(ctx, "tenant_z");
    assert.equal(missing, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: rate limit allows N then blocks N+1", async () => {
  const dir = tmpDir();
  try {
    const ctx = makeConfigCtx(join(dir, "config.sqlite"));
    await initSchema(ctx);
    const tenant = await getTenant(ctx, "tenant_b");
    assert.ok(tenant);
    for (let i = 0; i < tenant.rate_limit_per_minute; i++) {
      const d = await checkRateLimit(ctx, tenant);
      assert.equal(d.allowed, true, `call ${i + 1} should be allowed`);
    }
    const blocked = await checkRateLimit(ctx, tenant);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retry_after_seconds > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: rate limit is per-tenant (isolation)", async () => {
  const dir = tmpDir();
  try {
    const ctx = makeConfigCtx(join(dir, "config.sqlite"));
    await initSchema(ctx);
    const a = await getTenant(ctx, "tenant_a");
    const b = await getTenant(ctx, "tenant_b");
    assert.ok(a && b);
    for (let i = 0; i < b.rate_limit_per_minute; i++) {
      await checkRateLimit(ctx, b);
    }
    const bBlocked = await checkRateLimit(ctx, b);
    assert.equal(bBlocked.allowed, false);
    const aFirst = await checkRateLimit(ctx, a);
    assert.equal(aFirst.allowed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: resetRateLimit clears the window", async () => {
  const dir = tmpDir();
  try {
    const ctx = makeConfigCtx(join(dir, "config.sqlite"));
    await initSchema(ctx);
    const tenant = await getTenant(ctx, "tenant_b");
    assert.ok(tenant);
    for (let i = 0; i < tenant.rate_limit_per_minute; i++) {
      await checkRateLimit(ctx, tenant);
    }
    const blocked = await checkRateLimit(ctx, tenant);
    assert.equal(blocked.allowed, false);
    await resetRateLimit(ctx, tenant.id);
    const fresh = await checkRateLimit(ctx, tenant);
    assert.equal(fresh.allowed, true);
    assert.equal(fresh.current, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("voice: startCall, list, getCall, hangup", async () => {
  const dir = tmpDir();
  try {
    const ctx = makeVoiceCtx(join(dir, "voice.sqlite"));
    const call = await startCall(ctx, {
      tenant_id: "tenant_a",
      from_number: "+15551234567",
      to_number: "+15559876543",
    });
    assert.ok(call.id);
    assert.equal(call.status, "queued");

    const found = await getCall(ctx, call.id);
    assert.ok(found);
    assert.equal(found.id, call.id);

    const list = await listCalls(ctx);
    assert.equal(list.length, 1);

    const completed = await hangup(ctx, call.id);
    assert.ok(completed);
    assert.equal(completed.status, "completed");
    assert.ok(completed.ended_at);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("voice: tenant isolation (two DBs, two call lists)", async () => {
  const dir = tmpDir();
  try {
    const ctxA = makeVoiceCtx(join(dir, "voice_a.sqlite"));
    const ctxB = makeVoiceCtx(join(dir, "voice_b.sqlite"));
    await startCall(ctxA, { tenant_id: "tenant_a", from_number: "+1", to_number: "+2" });
    await startCall(ctxA, { tenant_id: "tenant_a", from_number: "+3", to_number: "+4" });
    await startCall(ctxB, { tenant_id: "tenant_b", from_number: "+5", to_number: "+6" });

    const aCalls = await listCalls(ctxA);
    const bCalls = await listCalls(ctxB);
    assert.equal(aCalls.length, 2, "tenant_a sees only its 2 calls");
    assert.equal(bCalls.length, 1, "tenant_b sees only its 1 call");
    assert.ok(aCalls.every((c) => c.tenant_id === "tenant_a"));
    assert.ok(bCalls.every((c) => c.tenant_id === "tenant_b"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("voice: activeCount reflects in-flight calls", async () => {
  const dir = tmpDir();
  try {
    const ctx = makeVoiceCtx(join(dir, "voice.sqlite"));
    assert.equal(await activeCount(ctx), 0);
    const c1 = await startCall(ctx, { tenant_id: "t", from_number: "+1", to_number: "+2" });
    const c2 = await startCall(ctx, { tenant_id: "t", from_number: "+3", to_number: "+4" });
    assert.equal(await activeCount(ctx), 2);
    await hangup(ctx, c1.id);
    assert.equal(await activeCount(ctx), 1);
    await hangup(ctx, c2.id);
    assert.equal(await activeCount(ctx), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("webhook verify: valid signature accepted, tampered rejected", () => {
  const { publicKey, secretKey } = nacl.sign.keyPair();
  const ts = String(Math.floor(Date.now() / 1000));
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  const message = Buffer.concat([Buffer.from(`${ts}.`), body]);
  const sig = Buffer.from(nacl.sign.detached(message, secretKey)).toString("hex");
  const pem = Buffer.from(publicKey).toString("base64");

  const ok = verifyTelnyxSignature({
    rawBody: body,
    signature: sig,
    timestamp: ts,
    publicKeyPem: pem,
  });
  assert.deepEqual(ok, { ok: true });

  const bad = verifyTelnyxSignature({
    rawBody: Buffer.from("tampered"),
    signature: sig,
    timestamp: ts,
    publicKeyPem: pem,
  });
  assert.equal(bad.ok, false);
});
