import { describe, it, expect } from 'vitest'

// Import the main module to verify it loads without error
import app from '../src/index'

describe('SQL Migration Agent', () => {
  it('should load the default export', () => {
    expect(app).toBeDefined()
    expect(typeof app.fetch).toBe('function')
  })

  it('should return 404 for unknown routes', async () => {
    const req = new Request('http://localhost/unknown', { method: 'GET' })
    const res = await app.fetch(req, {}, {})
    expect(res.status).toBe(404)
  })

  it('should return 400 for /migrate without required fields', async () => {
    const req = new Request('http://localhost/migrate', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' }
    })
    const res = await app.fetch(req, {}, {})
    expect(res.status).toBe(400)
  })

  it('should return 400 for /migrate with missing instances', async () => {
    const req = new Request('http://localhost/migrate', {
      method: 'POST',
      body: JSON.stringify({ migrationName: 'test' }),
      headers: { 'Content-Type': 'application/json' }
    })
    const res = await app.fetch(req, {}, {})
    expect(res.status).toBe(400)
  })

  it('should return 400 for /migrate with missing migrationName', async () => {
    const req = new Request('http://localhost/migrate', {
      method: 'POST',
      body: JSON.stringify({ instances: ['inst1'] }),
      headers: { 'Content-Type': 'application/json' }
    })
    const res = await app.fetch(req, {}, {})
    expect(res.status).toBe(400)
  })
})
