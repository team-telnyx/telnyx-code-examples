import { describe, it, expect } from 'vitest'

// Smoke test: verify the main module loads without error
// Run with: npx vitest run smoke_test.ts

describe('AI Call Summarizer — Smoke Test', () => {
  it('should import the default app handler', async () => {
    const mod = await import('./src/index')
    expect(mod.default).toBeDefined()
    expect(typeof mod.default.fetch).toBe('function')
  })

  it('should respond to /health with 200', async () => {
    const mod = await import('./src/index')
    const req = new Request('https://example.com/health')
    const res = await mod.default.fetch(req)
    expect(res.status).toBe(200)
  })

  it('should return 404 for unknown routes', async () => {
    const mod = await import('./src/index')
    const req = new Request('https://example.com/unknown')
    const res = await mod.default.fetch(req)
    expect(res.status).toBe(404)
  })

  it('should return 401 for webhook without valid signature', async () => {
    const mod = await import('./src/index')
    const req = new Request('https://example.com/webhook', {
      method: 'POST',
      body: JSON.stringify({ event_type: 'call.hangup' }),
    })
    const res = await mod.default.fetch(req)
    expect(res.status).toBe(401)
  })
})
</arg_value></tool_call>
