import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const acpDir = path.resolve(root, '../langgraph-acp');
const run = promisify(execFile);
const agentUrl = process.env.ACP_AGENT_URL ?? '';
const agentName = 'bring-your-framework-langgraph';
const conversation = `ui-${Date.now()}`;

async function rpc(method, args) {
  const response = await fetch(`${agentUrl}/agents/${agentName}/${conversation}/rpc/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `ACP ${method} failed (${response.status})`);
  return payload?.json?.value;
}

async function invoke(text) {
  const accepted = await rpc('receive', [text]);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const run = await rpc('run', [accepted.runId]);
    if (run?.status === 'completed' || run?.status === 'failed') {
      if (run.status === 'failed') throw new Error('The ACP agent reported a failed run. Check `telnyx-acp logs --tail`.');
      const stream = await fetch(`${agentUrl}/agents/${agentName}/${conversation}?subscribe=state,messages`);
      const reader = stream.body.getReader();
      const decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const match = buffer.match(/event: state\ndata: (.+?)(?:\n\n|$)/s);
        if (match) {
          const event = JSON.parse(match[1]);
          const state = event?.json?.snapshot;
          if (state?.lastRunId === accepted.runId) { await reader.cancel(); return { runId: accepted.runId, reply: state.lastReply }; }
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for the ACP reply.');
}

async function frameworkTrace() {
  try {
    const { stdout } = await run('telnyx-acp', ['logs', '--since', '10m'], { cwd: acpDir, maxBuffer: 2 * 1024 * 1024 });
    return stdout.split('\n').flatMap((line) => {
      const start = line.indexOf('{"framework_event"');
      if (start < 0) return [];
      try {
        return [JSON.parse(line.slice(start))];
      } catch {
        return [];
      }
    }).slice(-12);
  } catch {
    return [];
  }
}

async function acpTrace(runId) {
  try {
    const { stdout } = await run('telnyx-acp', ['traces', conversation, runId], { cwd: acpDir, maxBuffer: 256 * 1024 });
    return stdout.trim();
  } catch {
    return '';
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(await readFile(path.join(root, 'index.html'))); return;
    }
    if (request.method === 'POST' && request.url === '/api/invoke') {
      let body = ''; for await (const chunk of request) body += chunk;
      const { text } = JSON.parse(body); const result = await invoke(text);
      const [events, trace] = await Promise.all([frameworkTrace(), acpTrace(result.runId)]);
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ...result, events, trace })); return;
    }
    response.writeHead(404); response.end('Not found');
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(Number(process.env.PORT ?? 4173), '127.0.0.1', () => {
  console.log(`Bring Your Framework UI: http://127.0.0.1:${process.env.PORT ?? 4173}`);
  console.log(`ACP Edge mount: ${agentUrl}`);
  console.log(`ACP web: ${agentUrl}/web`);
  console.log(`ACP actor template: ${agentUrl}/agents/${agentName}/<conversation>`);
});
