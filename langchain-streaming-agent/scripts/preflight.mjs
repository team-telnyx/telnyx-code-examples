import { AgentClient } from "@telnyx/edge-runtime/client";
const client = new AgentClient(
  "wss://langchain-streaming-agent-e43e9ecb-3.telnyxcompute.com/websocket?session=preflight",
  { token: "demo", subscribe: ["state", "messages", "events"], resume: true, pingIntervalMs: 15000, pingTimeoutMs: 45000 },
);
process.on("unhandledRejection", (err) => console.error("rejection (reconnecting):", err?.message ?? err));
const messages = []; let tokens = 0; let tool = null; let done = false;
client.onMessages(({ snapshot, appended }) => { if (snapshot) messages.push(...snapshot); if (appended) messages.push(...appended); });
client.onEvents((e) => { const p = e.payload ?? {}; if (e.type === "token") tokens += 1; if (e.type === "tool_start") tool = p.tool; });
client.onState((s) => {
  if (done) return;
  const replies = messages.filter((m) => m.role === "assistant");
  if (s?.status === "idle" && s?.turn >= 1 && replies.length >= 1) {
    done = true;
    setTimeout(() => {
      const ok = tokens > 3 && tool === "lookup_order" && (replies.at(-1)?.content ?? "").length > 20;
      console.log(JSON.stringify({ ok, tokens, tool }));
      client.close(); process.exit(ok ? 0 : 1);
    }, 1500);
  }
});
async function sendWithRetry(text) {
  for (let a = 1; a <= 3; a += 1) {
    try { await client.stub.send(text); return; }
    catch (err) { console.error(`send attempt ${a} failed: ${err?.message ?? err}`); await new Promise((r) => setTimeout(r, 4000)); }
  }
  throw new Error("send failed after 3 attempts");
}
await new Promise((r) => setTimeout(r, 2000));
await sendWithRetry("Where is my order ORD-1042?");
setTimeout(() => { console.error("TIMEOUT"); process.exit(1); }, 120_000);
