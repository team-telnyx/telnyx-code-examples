import { describe, it, expect } from 'vitest';
import app from '../src/index';

describe('PatientAgent', () => {
  it('should load the default export without error', () => {
    expect(app).toBeDefined();
    expect(typeof app.fetch).toBe('function');
  });

  it('should return 404 for unknown routes', async () => {
    const req = new Request('https://example.com/unknown', { method: 'GET' });
    const env: any = {
      KV: { get: async () => null, put: async () => {} },
      TELNYX: { webhooks: { unwrap: async () => ({ data: { payload: {} } }) } },
      TELNYX_PHONE_NUMBER: '+1555XXXXXXXX',
      DEMO_MODE: 'true',
      logger: { info: () => {}, exception: () => {} },
    };
    const res = await app.fetch(req, env, {} as ExecutionContext);
    expect(res.status).toBe(404);
  });

  it('should handle GET /state endpoint', async () => {
    const req = new Request('https://example.com/state', { method: 'GET' });
    const env: any = {
      KV: { get: async () => null, put: async () => {} },
      TELNYX: { webhooks: { unwrap: async () => ({ data: { payload: {} } }) } },
      TELNYX_PHONE_NUMBER: '+1555XXXXXXXX',
      DEMO_MODE: 'true',
      logger: { info: () => {}, exception: () => {} },
    };
    const res = await app.fetch(req, env, {} as ExecutionContext);
    expect(res.status).toBe(200);
  });
});
