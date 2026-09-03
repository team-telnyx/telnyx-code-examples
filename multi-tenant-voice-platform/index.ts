import { Router } from '@telnyx/edge-sdk/router';
import { kv } from '@telnyx/edge-sdk/kv';
import { sql } from '@telnyx/edge-sdk/storage';
import { Actor } from '@telnyx/edge-sdk/actor';
import { Telnyx } from '@telnyx/edge-sdk';
import { verifyWebhookSignature } from './webhooks';

// Initialize Telnyx SDK from environment
const telnyx = new Telnyx({
  apiKey: process.env.TELNYX_API_KEY || '',
});

// Per-tenant StatefulActor namespace
const TenantActor = Actor.namespace('tenant-call-state');

/**
 * Per-tenant call state actor.
 * Each tenant gets its own isolated actor instance.
 */
class TenantCallStateActor extends Actor {
  // In-memory call state for this tenant (isolated per actor instance)
  private calls: Map<string, any> = new Map();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const callId = url.searchParams.get('call_id');

    if (request.method === 'GET') {
      const call = this.calls.get(callId || '');
      if (!call) {
        return new Response(JSON.stringify({ error: 'Call not found' }), { status: 404 });
      }
      return new Response(JSON.stringify(call), { status: 200 });
    }

    if (request.method === 'POST') {
      const body = await request.json() as any;
      this.calls.set(body.call_id, body);
      return new Response(JSON.stringify({ status: 'stored' }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
}

TenantActor.register(TenantCallStateActor);

const app = new Router();

/**
 * GET /health
 * Health check endpoint.
 */
app.get('/health', async () => {
  return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
});

/**
 * POST /webhook/call-control
 * Inbound Call Control webhook handler.
 * Routes calls by tenant ID header, enforces per-tenant rate limits,
 * fetches tenant config from SQL, and forwards to tenant webhook URL.
 */
app.post('/webhook/call-control', async (request) => {
  try {
    // Verify Telnyx Ed25519 webhook signature
    const verified = await verifyWebhookSignature(request);
    if (!verified) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 });
    }

    const body = await request.json() as any;
    const payload = body.data?.payload || body;

    // Extract tenant ID from header
    const tenantId = request.headers.get('x-tenant-id');
    if (!tenantId) {
      return new Response(JSON.stringify({ error: 'Missing tenant ID' }), { status: 400 });
    }

    // --- KV: Per-tenant rate limit check ---
    const rateKey = `tenant:${tenantId}:rate`;
    const rateData = await kv.get(rateKey);
    const rateInfo = rateData ? JSON.parse(rateData) : { count: 0, reset: Date.now() + 60000 };

    // Reset window every 60 seconds
    if (Date.now() > rateInfo.reset) {
      rateInfo.count = 0;
      rateInfo.reset = Date.now() + 60000;
    }

    // Fetch tenant config from SQL to get max_calls
    const tenantConfig = await sql.exec(
      'SELECT * FROM tenants WHERE id = ?',
      tenantId
    ).then((rows: any[]) => rows?.[0]);

    if (!tenantConfig) {
      return new Response(JSON.stringify({ error: 'Tenant not found' }), { status: 404 });
    }

    const maxCalls = tenantConfig.settings?.max_calls || 100;

    if (rateInfo.count >= maxCalls) {
      // Rate limited
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 });
    }

    // Increment rate counter
    rateInfo.count += 1;
    await kv.put(rateKey, JSON.stringify(rateInfo));

    // --- StatefulActor: Per-tenant call state ---
    const actor = TenantActor.get(tenantId);
    await actor.fetch(new Request('https://actor.local/state', {
      method: 'POST',
      body: JSON.stringify({
        call_id: payload.call_control_id,
        event: body.event_type,
        state: payload,
      }),
    }));

    // --- Webhook: Forward to tenant's webhook_url ---
    const tenantWebhookUrl = tenantConfig.settings?.webhook_url;
    if (tenantWebhookUrl) {
      // In demo mode, log instead of forwarding
      if (process.env.DEMO_MODE === 'true') {
        console.log(`[DEMO] Forwarding event to tenant ${tenantId} webhook: ${tenantWebhookUrl}`, {
          event: body.event_type,
          call_id: payload.call_control_id,
        });
      } else {
        // Live mode: forward to tenant webhook
        await fetch(tenantWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
    }

    // Handle Call Control commands based on event type
    if (body.event_type === 'call.initiated') {
      // Answer the call
      await telnyx.calls.answer(payload.call_control_id);
    }

    return new Response(JSON.stringify({ status: 'processed' }), { status: 200 });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
});

/**
 * GET /tenants/:id
 * Retrieve tenant configuration from SQL DB.
 */
app.get('/tenants/:id', async (request, { params }) => {
  try {
    const tenantId = params.id;
    const rows = await sql.exec('SELECT * FROM tenants WHERE id = ?', tenantId);
    const tenant = rows?.[0];

    if (!tenant) {
      return new Response(JSON.stringify({ error: 'Tenant not found' }), { status: 404 });
    }

    // Mask sensitive fields
    const safeTenant = {
      id: tenant.id,
      name: tenant.name,
      settings: tenant.settings,
    };

    return new Response(JSON.stringify(safeTenant), { status: 200 });
  } catch (err) {
    console.error('Tenant lookup error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
});

/**
 * GET /tenants/:id/calls/:callId
 * Retrieve per-tenant call state from StatefulActor.
 */
app.get('/tenants/:id/calls/:callId', async (request, { params }) => {
  try {
    const { id: tenantId, callId } = params;
    const actor = TenantActor.get(tenantId);
    const resp = await actor.fetch(
      new Request(`https://actor.local/state?call_id=${callId}`, { method: 'GET' })
    );
    const data = await resp.json();
    return new Response(JSON.stringify(data), { status: resp.status });
  } catch (err) {
    console.error('Call state lookup error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
});

export default app;
