import type { Env } from "@telnyx/edge-runtime";
import { DemoAgent } from "@/demo/demoAgent";
import { AccountsActor } from "@/demo/accountsActor";
import { renderPage, renderLoginPage } from "@/ui";
import { extractTranscriptEvents, mapTelnyxWebhookToCallEvent, verifyTelnyxSignature } from "@/call/telnyx";
import { resolveDemoMode } from "@/server/env";
import { readSessionCookie, sessionCookie, clearedSessionCookie } from "@/server/auth";

// Edge function entry point. Re-exports the actor classes (required by the
// runtime) and routes HTTP: the login gate at /, demo APIs on the DEMO actor,
// auth on the ACCOUNTS actor. /api/* (except auth + the Telnyx webhook)
// require a valid session cookie resolved against ACCOUNTS.

export { DemoAgent, AccountsActor };

/** Every response is no-cache: the demo state mutates every second and a cached page or API response would show stale state forever. */
function applyNoCache(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store, no-cache, must-revalidate");
  headers.set("pragma", "no-cache");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function route(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const demo = env.DEMO.idFromName("demo");
    const accounts = env.ACCOUNTS.idFromName("main");
    const input = async (): Promise<Record<string, unknown>> => ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

    if (url.pathname === "/api/auth/signup" && request.method === "POST") {
      return Response.json({ error: "Account creation is disabled for this demo." }, { status: 403 });
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      const result = await accounts.signIn((await input()) as { email: string; password: string });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.rateLimited ? 429 : 401 });
      return Response.json({ ok: true, email: result.email }, { headers: { "set-cookie": sessionCookie(result.token, url.protocol === "https:") } });
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      const token = readSessionCookie(request);
      if (token) await accounts.signOut(token);
      return Response.json({ ok: true }, { headers: { "set-cookie": clearedSessionCookie(url.protocol === "https:") } });
    }

    if (url.pathname.startsWith("/api/webhooks/")) {
      if ((await resolveDemoMode(env.SECRETS)) === "mock") {
        return Response.json({ error: "mock mode" }, { status: 503 });
      }
      const rawBody = await request.text();
      const publicKeyBase64 = await env.SECRETS.get("TELNYX_PUBLIC_KEY");
      const timestamp = request.headers.get("telnyx-timestamp");
      const signature = request.headers.get("telnyx-signature-ed25519");
      if (!publicKeyBase64 || !timestamp || !signature || !verifyTelnyxSignature({ publicKeyBase64, timestamp, signatureBase64: signature, rawBody })) {
        console.warn(
          `[telnyx] webhook rejected: key=${publicKeyBase64 ? "present" : "MISSING"} ts=${timestamp ? "present" : "MISSING"} sig=${signature ? "present" : "MISSING"}`,
        );
        return Response.json({ error: publicKeyBase64 ? "invalid signature" : "webhook verification unavailable" }, { status: publicKeyBase64 ? 401 : 503 });
      }
      const mapped = mapTelnyxWebhookToCallEvent(rawBody);
      if (mapped) {
        await demo.applyCallEvent(mapped.event);
      } else {
        for (const event of extractTranscriptEvents(rawBody)) {
          await demo.applyCallEvent(event);
        }
      }
      return Response.json({});
    }

    if (url.pathname === "/api/voice/reschedule" && request.method === "POST") {
      if ((await resolveDemoMode(env.SECRETS)) !== "live") {
        return Response.json({ success: false, error: "mock mode" }, { status: 503 });
      }
      const result = await demo.rescheduleAppointment((await input()) as Record<string, unknown>);
      return Response.json(result, { status: result.success === true ? 200 : 422 });
    }

    const token = readSessionCookie(request);
    const session = token ? await accounts.checkToken(token) : { authed: false };

    if (url.pathname === "/" && request.method === "GET") {
      const html = session.authed ? renderPage() : renderLoginPage();
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (!session.authed) {
      return Response.json({ error: "not signed in" }, { status: 401 });
    }

    if (url.pathname === "/api/state" && request.method === "GET") {
      return Response.json({ state: await demo.snapshot() });
    }

    if (url.pathname === "/api/demo/start" && request.method === "POST") {
      const result = await demo.startDemo((await input()) as { reset?: boolean; paceMs?: number });
      if (!result.ok) return Response.json({ error: result.error, phase: (await demo.snapshot()).phase }, { status: 409 });
      return Response.json({ state: result.state });
    }

    if (url.pathname === "/api/demo/stop" && request.method === "POST") {
      return Response.json({ state: await demo.stopDemo() });
    }

    if (url.pathname === "/api/demo/missed-call" && request.method === "POST") {
      const result = await demo.startMissedCallback((await input()) as { paceMs?: number });
      if (!result.ok) return Response.json({ error: result.error, phase: (await demo.snapshot()).phase }, { status: 409 });
      return Response.json({ state: result.state });
    }

    if (url.pathname === "/api/intake" && request.method === "POST") {
      const result = await demo.intakePatient((await input()) as { fullName?: string; phoneE164?: string; slotId?: string });
      if (!result.ok) return Response.json({ error: result.error }, { status: 422 });
      return Response.json({ ok: true, state: result.state });
    }

    if (url.pathname === "/api/demo/reset" && request.method === "POST") {
      return Response.json({ state: await demo.reset() });
    }

    if (url.pathname === "/api/settings" && request.method === "POST") {
      const body = await input();
      const result = await demo.updateSettings(body);
      if (!result.ok) return Response.json({ error: "invalid settings", errors: result.errors }, { status: 422 });
      return Response.json({ settings: result.state.settings });
    }

    return Response.json({ error: "not found" }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await route(request, env);
    return applyNoCache(response);
  },
};
