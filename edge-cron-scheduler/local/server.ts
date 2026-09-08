import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import Telnyx from "telnyx";
import app from "../src/index.js";
import { CronAgent } from "../src/cron-agent.js";
import { localContext } from "./context.js";

const path = resolve(process.env.SCHEDULER_DB ?? ".data/scheduler.sqlite");
mkdirSync(dirname(path), { recursive: true });
const local = localContext(path);
const demo = process.env.DEMO_MODE !== "false";
const token = process.env.SCHEDULER_TOKEN || randomBytes(24).toString("hex");
const agent = new CronAgent(local.ctx, {
  DEMO_MODE: demo ? "true" : "false",
  TELNYX: demo
    ? undefined
    : new Telnyx({
        apiKey: process.env.TELNYX_API_KEY,
        maxRetries: 0,
        timeout: 10000,
      }),
  TELNYX_PHONE_NUMBER: process.env.TELNYX_PHONE_NUMBER,
  TELNYX_CONNECTION_ID: process.env.TELNYX_CONNECTION_ID,
  NOTIFICATION_PHONE_NUMBER: process.env.NOTIFICATION_PHONE_NUMBER,
  WEBHOOK_HOSTS: process.env.WEBHOOK_HOSTS,
});
await local.ready();
await agent.initialize();
// Serialize HTTP and alarm turns, as the production actor runtime does.
let turn = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const result = turn.then(fn);
  turn = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
const timer = setInterval(() => {
  void serial(async () => {
    const due = await local.ctx.storage.getAlarm();
    if (due !== null && due <= Date.now()) {
      await local.ctx.storage.deleteAlarm();
      await agent.alarm({ retryCount: 0, isRetry: false });
    }
  }).catch(console.error);
}, 100);
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) {
        res.writeHead(413);
        res.end("Request too large");
        return;
      }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      ...(body.length ? { body } : {}),
    });
    const response = await serial(() =>
      app.fetch(request, {
        SCHEDULER_TOKEN: token,
        CRON_AGENT: { idFromName: () => agent },
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end("Request failed");
  }
});
const port = Number(process.env.PORT ?? 8787);
server.listen(port, "127.0.0.1", () => {
  console.log(
    `Scheduler: http://127.0.0.1:${port} (${demo ? "demo" : "LIVE"} mode)`,
  );
  console.log(
    `Open dashboard: http://127.0.0.1:${port}/${process.env.SCHEDULER_TOKEN ? "" : "#token=" + encodeURIComponent(token)}`,
  );
  if (!process.env.SCHEDULER_TOKEN)
    console.log(`Temporary local bearer token: ${token}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => {
      void turn.finally(() => {
        local.close();
        process.exit(0);
      });
    });
  });
