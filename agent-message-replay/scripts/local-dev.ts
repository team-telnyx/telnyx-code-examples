/**
 * Local development harness: smoke-tests the recording store against an
 * in-memory shim of the actor SQL surface. Playback (MessageLog appends,
 * state patches, events) requires the deployed actor runtime — this harness
 * verifies only the storage round-trip that playback depends on.
 *
 *   npm run local:dev
 */
import { DEMO_SCRIPT, DEMO_CONVERSATION_ID } from "../src/demo-script.js";
import { loadRecording, storeRecording } from "../src/script.js";

/** Minimal in-memory shim of the actor SQLite surface used by script.ts. */
function memorySql() {
  const rows = new Map<number, Record<string, unknown>>();
  return {
    exec(
      query: string,
      ...binds: unknown[]
    ): { toArray(): Record<string, unknown>[] } {
      if (/CREATE TABLE/i.test(query)) return { toArray: () => [] };
      if (/DELETE FROM/i.test(query)) {
        rows.clear();
        return { toArray: () => [] };
      }
      if (/INSERT INTO/i.test(query)) {
        rows.set(Number(binds[0]), {
          idx: Number(binds[0]),
          role: binds[1],
          content: binds[2],
          delay_ms: Number(binds[3]),
          stage: binds[4],
        });
        return { toArray: () => [] };
      }
      if (/SELECT/i.test(query)) {
        return {
          toArray: () =>
            [...rows.values()].sort((a, b) => Number(a.idx) - Number(b.idx)),
        };
      }
      return { toArray: () => [] };
    },
  };
}

function main(): void {
  console.log("agent-message-replay local harness");
  console.log("-".repeat(48));

  const sql = memorySql();
  const total = storeRecording(sql, {
    conversation_id: DEMO_CONVERSATION_ID,
    steps: DEMO_SCRIPT,
    replace: true,
  });
  console.log(`stored demo recording: ${total} steps`);

  const loaded = loadRecording(sql);
  if (loaded.length !== total) {
    throw new Error(`round-trip mismatch: stored ${total}, loaded ${loaded.length}`);
  }
  for (let i = 0; i < total; i += 1) {
    const wrote = DEMO_SCRIPT[i];
    const read = loaded[i];
    if (wrote?.content !== read?.content || wrote?.role !== read?.role) {
      throw new Error(`round-trip mismatch at step ${i}`);
    }
    if ((wrote?.stage ?? null) !== (read?.stage ?? null)) {
      throw new Error(`stage mismatch at step ${i}`);
    }
  }
  console.log(`round-trip OK: ${loaded.length} steps, stages preserved`);
  console.log("-".repeat(48));
  console.log("Deploy with: npm run ship  (requires a provisioned Edge function)");
}

try {
  main();
} catch (error) {
  console.error("local harness failed:", error);
  process.exit(1);
}
