/**
 * Smoke + behavioral test for fluency-lab.
 *
 * Structural checks run everywhere. The behavioral block instantiates the real
 * FluencyLab actor against an in-memory actor context (node:sqlite) and drives
 * the acceptance-criteria flows: dictionary create/PATCH, the same-second 409
 * race with the one-shot rival-editor fixture, dict_log schema + rows, the
 * nightly canary with stable-id re-arm and version-from-state confirmation,
 * and greeting re-synthesis after an edit.
 *
 * Run with: npx tsx smoke_test.ts
 */
import handler, {
  FluencyLab,
  clinicIdFor,
  parseStaffText,
  applyRivalEdit,
  confirmVersionFromState,
  secondsUntilNext,
  verifyTelnyxSignature,
  RIVAL_EDITOR_ITEM,
} from "./src/index";

let failures = 0;
let checks = 0;
const check = (name: string, cond: boolean): void => {
  checks++;
  if (cond) console.log(`\u2705 ${name}`);
  else { console.error(`\u274c ${name}`); failures++; }
};

// ---------- Structural (always on) ----------

async function structural(): Promise<void> {
  check("default export has fetch", typeof (handler as any).fetch === "function");
  check("FluencyLab is a class", typeof FluencyLab === "function");
  check("clinicIdFor is a function", typeof clinicIdFor === "function");
  check("parseStaffText is a function", typeof parseStaffText === "function");
  check("applyRivalEdit is a function", typeof applyRivalEdit === "function");
  check("confirmVersionFromState is a function", typeof confirmVersionFromState === "function");

  const alias = parseStaffText("Add Novocaine to the dictionary \u2014 NO-voh-kayn");
  check(
    "alias parse (em-dash form)",
    alias?.type === "alias" && alias.alias === "NO-voh-kayn" && alias.text === "Novocaine",
  );

  const phoneme = parseStaffText("add Dr. Ng -> /d\u0279.\u025b\u014b/");
  check(
    "phoneme parse (arrow + slashes)",
    phoneme?.type === "phoneme" && phoneme.phoneme === "d\u0279.\u025b\u014b" && phoneme.alphabet === "ipa",
  );

  const long = "x".repeat(201);
  check("over-limit term rejected", parseStaffText(`add ${long} -> alias`) === null);
  check("invalid text returns null", parseStaffText("hello world") === null);

  const env = { CLINIC_NUMBERS: '{"+15551234567":"clinicA"}', INTAKE_NUMBER: "+15559999999" } as any;
  check("clinicIdFor mapped", clinicIdFor("+15551234567", env) === "clinicA");
  check("clinicIdFor fallback", clinicIdFor("+15550000000", env) === "riverbentalclinic");

  const rival = applyRivalEdit([{ text: "Dr. Ng", type: "phoneme", phoneme: "x", alphabet: "ipa" }]);
  check(
    "rival edit appended once",
    rival.length === 2 && rival.filter((i) => i.text === RIVAL_EDITOR_ITEM.text).length === 1,
  );
  check("rival edit dedupes repeats", applyRivalEdit(rival).filter((i) => i.text === RIVAL_EDITOR_ITEM.text).length === 1);
  check("version confirmed from state", confirmVersionFromState(2, 2));
  check("version mismatch not confirmed", !confirmVersionFromState(2, 3));
  check("version zero not confirmed", !confirmVersionFromState(0, 0));

  const d1 = secondsUntilNext("23:59", "UTC");
  check("secondsUntilNext bounded", d1 >= 60 && d1 <= 86400);

  const proto = FluencyLab.prototype as any;
  check("receive method", typeof proto.receive === "function");
  check("applyEdit method", typeof proto.applyEdit === "function");
  check("canary method", typeof proto.canary === "function");
  check("getGreetingAudio method", typeof proto.getGreetingAudio === "function");

  const fresh = new FluencyLab(bareCtx(), minimalEnv());
  const seed = (fresh as any).initialState();
  check(
    "initial state shape",
    seed.dictId === null && Array.isArray(seed.pending) && seed.lastCanaryHash === null && seed.demoConflictDone === false,
  );

  const resp404 = await (handler as any).fetch(new Request("http://localhost/nowhere"), {} as any);
  check("unknown route returns 404", resp404.status === 404);
  const respNoSig = await (handler as any).fetch(
    new Request("http://localhost/webhooks/messaging", { method: "POST", body: "{}" }),
    {} as any,
  );
  check("webhook without signature returns 401", respNoSig.status === 401);
}

// ---------- Ed25519 signature round-trip ----------

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function signatureRoundTrip(): Promise<void> {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
  const pubRaw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const ts = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ data: { payload: { text: "hello" } } });
  const data = new TextEncoder().encode(`${ts}|${body}`);
  const sig = await crypto.subtle.sign({ name: "Ed25519" } as any, pair.privateKey, data);
  const ok = await verifyTelnyxSignature(body, ts, bytesToB64(new Uint8Array(sig)), bytesToB64(new Uint8Array(pubRaw)));
  check("Ed25519 signature verifies", ok === true);

  const bad = await verifyTelnyxSignature(
    body, ts, bytesToB64(new Uint8Array(sig)).slice(0, -2) + "AA", bytesToB64(new Uint8Array(pubRaw)),
  );
  check("tampered signature rejected", bad === false);

  const stale = await verifyTelnyxSignature(body, "1", bytesToB64(new Uint8Array(sig)), bytesToB64(new Uint8Array(pubRaw)));
  check("stale timestamp rejected", stale === false);
}

// ---------- Behavioral (needs node:sqlite for the actor context) ----------

function bareCtx(): any {
  const kv = new Map<string, unknown>();
  const storage: any = {
    async get(key: string) { return kv.get(key); },
    async put(key: string, value: unknown) { kv.set(key, value); },
    async delete(key: string) { kv.delete(key); },
    async list(opts?: { prefix?: string; limit?: number }) {
      const out = new Map<string, unknown>();
      for (const k of [...kv.keys()].filter((k) => !opts?.prefix || k.startsWith(opts.prefix))) {
        out.set(k, kv.get(k));
        if (opts?.limit && out.size >= opts.limit) break;
      }
      return out;
    },
    async transaction(fn: (txn: any) => Promise<unknown>) {
      return fn({ get: (k: string) => kv.get(k), put: (k: string, v: unknown) => void kv.set(k, v), list: storage.list });
    },
    transactionSync<T>(fn: () => T): T { return fn(); },
    setAlarm(_t: number) {},
    deleteAlarm() {},
  };
  return {
    storage,
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
    id: { name: "riverbentalclinic", toString: () => "riverbentalclinic" },
  };
}

function minimalEnv(): any {
  return {
    DEMO_MODE: "true",
    VOICE_ID: "Telnyx.Ultra.test",
    GREETING_TEXT: "g",
    CANARY_TEXT: "c",
    VERIFY_AT: "02:00",
    CLINIC_TZ: "UTC",
    INTAKE_NUMBER: "+15550000000",
    CLINIC_NUMBERS: "{}",
    OWNER_NUMBER: "+15551111111",
    SECRETS: { get: async () => undefined },
  };
}

interface Harness {
  lab: FluencyLab;
  db: any;
  kv: Map<string, unknown>;
  state(): Promise<any>;
  receive(text: string, eventId: string, from?: string): Promise<void>;
  rows(sql: string): any[];
  sqlExec: (q: string, ...b: unknown[]) => unknown;
}

async function makeHarness(): Promise<Harness | null> {
  let DatabaseSync: any;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    console.log("\u26a0\ufe0f  SKIP behavioral block: node:sqlite unavailable on this Node runtime");
    return null;
  }
  const kv = new Map<string, unknown>();
  const db = new DatabaseSync(":memory:");
  const runSql = (query: string, bindings: unknown[]) => {
    const stmt = db.prepare(query);
    if (/^\s*(select|with)/i.test(query)) {
      const rows = stmt.all(...(bindings as never[])) as Record<string, unknown>[];
      return { [Symbol.iterator]: () => rows[Symbol.iterator](), toArray: () => rows };
    }
    stmt.run(...(bindings as never[]));
    return { [Symbol.iterator]: () => [][Symbol.iterator](), toArray: () => [] };
  };
  const storage: any = {
    async get(key: string) { return kv.get(key); },
    async put(key: string, value: unknown) { kv.set(key, value); },
    async delete(key: string) { kv.delete(key); },
    async list(opts?: { prefix?: string; limit?: number }) {
      const out = new Map<string, unknown>();
      for (const k of [...kv.keys()].filter((k) => !opts?.prefix || k.startsWith(opts.prefix))) {
        out.set(k, kv.get(k));
        if (opts?.limit && out.size >= opts.limit) break;
      }
      return out;
    },
    async transaction(fn: (txn: any) => Promise<unknown>) {
      return fn({ get: (k: string) => kv.get(k), put: (k: string, v: unknown) => void kv.set(k, v), list: storage.list });
    },
    transactionSync<T>(fn: () => T): T { return fn(); },
    setAlarm(_t: number) { kv.set("__alarm__", _t); },
    deleteAlarm() { kv.delete("__alarm__"); },
    sql: {
      exec(query: string, ...bindings: unknown[]) {
        const parts = query.split(/;\s*/).map((s) => s.trim()).filter(Boolean);
        if (parts.length <= 1 || bindings.length > 0) return runSql(query, bindings);
        let cur: any = { [Symbol.iterator]: () => [][Symbol.iterator](), toArray: () => [] };
        for (const p of parts) cur = runSql(p, []);
        return cur;
      },
    },
  };
  const ctx: any = {
    storage,
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
    id: { name: "riverbentalclinic", toString: () => "riverbentalclinic" },
  };
  const env: any = {
    DEMO_MODE: "true",
    VOICE_ID: "Telnyx.Ultra.test",
    GREETING_TEXT: "Thank you for calling Riverbental Clinic.",
    CANARY_TEXT: "Welcome to Riverbental Clinic.",
    VERIFY_AT: "02:00",
    CLINIC_TZ: "UTC",
    INTAKE_NUMBER: "+15550000000",
    CLINIC_NUMBERS: "{}",
    OWNER_NUMBER: "+15551111111",
    SECRETS: {
      get: async (k: string) => (k === "TELNYX_API_KEY" ? "key" : undefined),
    },
  };
  const lab = new FluencyLab(ctx, env);
  const receive = (text: string, eventId: string, from = "+15552222222") =>
    (lab as any).receive({ text, from, to: "+15550000000", eventId });
  const rows = (sql: string): any[] => (storage.sql.exec(sql) as any).toArray();
  return {
    lab, db, kv,
    state: () => (lab as any).getState(),
    receive,
    sqlExec: (q: string, ...b: unknown[]) => storage.sql.exec(q, ...b),
    rows,
  };
}

async function behavioral(): Promise<void> {
  const h = await makeHarness();
  if (!h) return;
  const { receive, state, rows } = h;

  // AC 2 + 3: first staff text bootstraps the dictionary (Dr. Ng phoneme),
  // the one-shot rival editor (Zyrtec, standing in for the same-second second
  // staff text) wins the race, our PATCH gets 409/90200, re-fetches, re-applies
  // on the fresh version — final dictionary holds every item exactly once.
  await receive("add Novocaine to the dictionary \u2014 NO-voh-kayn", "evt-1");
  let st = await state();
  const terms = () => st.items.map((i: any) => i.text.toLowerCase()).sort();
  check("race: demo conflict consumed once", st.demoConflictDone === true);
  check("race: final version is v3 (rival bump + retry)", st.version === 3);
  check("race: phoneme + both aliases present", terms().join(",") === "dr. ng,novocaine,zyrtec");
  check("race: each item exactly once", new Set(terms()).size === terms().length);
  check("race: pending queue drained", st.pending.length === 0);

  // AC 5: dict_log exists with the exact schema; one row per applied item.
  const schema = (h.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'dict_log'").get() as any).sql;
  for (const col of ["clinic_id", "dict_version", "item_text", "item_type", "applied_at", "applied_by"]) {
    check(`dict_log schema has ${col}`, schema.includes(col));
  }
  const applied = rows(`SELECT * FROM dict_log WHERE item_type IN ('alias','phoneme')`).map((r: any) => r.item_text);
  check("dict_log: one row per applied item", applied.length === 2 && applied.includes("Novocaine") && applied.includes("Zyrtec"));
  const rivalRow = rows(`SELECT * FROM dict_log WHERE applied_by = 'rival-editor'`)[0];
  check("dict_log: rival row recorded", !!rivalRow && rivalRow.item_text === "Zyrtec");

  // AC 4: greeting re-synthesized automatically after the successful PATCH.
  const greetingRow = rows(`SELECT * FROM dict_log WHERE item_text = '__greeting_resynthesized__'`);
  check("greeting re-synthesized and logged", greetingRow.length === 1 && greetingRow[0].dict_version === 3);
  st = await state();
  check("greeting hash recorded in state", typeof st.lastGreetingHash === "string" && st.lastGreetingVersion === 3);

  // AC 8: second staff text (same second) reuses the same actor, dictionary
  // version intact — same-term re-add is idempotent, no PATCH, no new rows.
  const before = rows(`SELECT COUNT(*) AS n FROM dict_log`)[0].n;
  await receive("add Zyrtec to the dictionary \u2014 ZEER-teck", "evt-2");
  st = await state();
  const after = rows(`SELECT COUNT(*) AS n FROM dict_log`)[0].n;
  check("second staff text: same actor, version intact", st.version === 3);
  check("second staff text: idempotent re-add, no new log rows", after === before && st.demoConflictDone === true);

  // A genuinely new term after the race applies cleanly (fixture is one-shot).
  await receive("add Acyclovir to the dictionary \u2014 AY-sye-klo-veer", "evt-3");
  st = await state();
  check("post-race edit applies on the current version", st.version === 4 && st.items.some((i: any) => i.text === "Acyclovir"));
  const acyRow = rows(`SELECT * FROM dict_log WHERE item_text = 'Acyclovir'`);
  check("post-race edit logged once", acyRow.length === 1 && acyRow[0].dict_version === 4);

  // AC 6: nightly canary fires, hashes, logs the dict version used, re-arms.
  await (h.lab as any).canary();
  const canaryRows = rows(`SELECT * FROM dict_log WHERE item_text IN ('__canary_match__','__canary_drift__')`);
  check("canary: logged dict version", canaryRows.length === 1 && canaryRows[0].dict_version === 4);
  st = await state();
  check("canary: hash stored", typeof st.lastCanaryHash === "string");
  const armed = rows(`SELECT id FROM _a_tasks WHERE id = 'verify:riverbentalclinic'`);
  check("canary: stable task id re-armed", armed.length === 1);
  await (h.lab as any).canary();
  const canaryRowsAfterSecond = rows(`SELECT * FROM dict_log WHERE item_text IN ('__canary_match__','__canary_drift__')`);
  check("canary: second run compares hashes", canaryRowsAfterSecond.length === 2 && canaryRows[0].item_text === "__canary_drift__" && canaryRowsAfterSecond[1].item_text === "__canary_match__");

  // AC 7: the canary confirms the dict version from durable state.
  const confirmed = rows(`SELECT * FROM dict_log WHERE item_text = '__canary_state_confirmed__'`);
  check("canary: version confirmed from state", confirmed.length >= 1 && confirmed[confirmed.length - 1].dict_version === 4);

  // AC 4: GET /greeting-audio surface returns audio bytes.
  const audio: Uint8Array = await (h.lab as any).getGreetingAudio();
  check("greeting audio returns bytes", audio instanceof Uint8Array && audio.length > 0);

  // Malformed staff text replies with the usage hint (no mutation).
  const beforeHint = rows(`SELECT COUNT(*) AS n FROM dict_log`)[0].n;
  const demoLines: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]): void => { demoLines.push(args.join(" ")); };
  try {
    await receive("what's the weather", "evt-4");
  } finally {
    console.log = origLog;
  }
  check("invalid text: usage hint, no mutation", rows(`SELECT COUNT(*) AS n FROM dict_log`)[0].n === beforeHint && (await state()).version === 4);
  check("usage hint sent in demo", demoLines.some((l) => l.includes("Usage:")));

  void h.sqlExec;
}

async function runSmokeTest(): Promise<void> {
  await structural();
  await signatureRoundTrip();
  await behavioral();
  if (failures > 0) {
    console.error(`\n${failures} of ${checks} check(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${checks} checks passed.`);
}

runSmokeTest().catch((e) => { console.error(e); process.exit(1); });
