import { Agent, StateStore, BlobStore, SqlDatabase } from '@telnyx/edge-sdk';
import { serve } from '@telnyx/edge-sdk/http';

// --- Environment ---
const TELEPHONY_API_KEY = process.env.TELNYX_API_KEY || '';
const BLOB_STORE_URL = process.env.BLOB_STORE_URL || 'memory://snapshots';
const SQL_DB_URL = process.env.SQL_DB_URL || 'sqlite://./snapshots.db';

// --- SnapshotAgent: extends Agent with StateStore + BlobStore ---
class SnapshotAgent extends Agent {
  public blobs: BlobStore;
  public db: SqlDatabase;

  constructor() {
    super({
      apiKey: TELEPHONY_API_KEY,
      name: 'snapshot-agent',
    });
    this.blobs = new BlobStore(BLOB_STORE_URL);
    this.db = new SqlDatabase(SQL_DB_URL);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        blob_key TEXT NOT NULL,
        description TEXT
      )
    `);
  }

  // --- Snapshot: getState() → serialize → BlobStore put → SQL log ---
  async snapshot(description: string = ''): Promise<string> {
    const state = await this.getState();
    const serialized = JSON.stringify(state);
    const blobKey = `snapshot-${Date.now()}`;
    await this.blobs.put(blobKey, serialized);
    const snapshotId = `snap_${Date.now()}`;
    const timestamp = new Date().toISOString();
    this.db.exec(
      `INSERT INTO snapshots (id, timestamp, blob_key, description) VALUES (?, ?, ?, ?)`,
      [snapshotId, timestamp, blobKey, description]
    );
    return snapshotId;
  }

  // --- Restore: SQL lookup → BlobStore get → replaceState() ---
  async restore(snapshotId: string): Promise<any> {
    const rows = this.db.query(
      `SELECT blob_key FROM snapshots WHERE id = ?`,
      [snapshotId]
    );
    if (rows.length === 0) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    const blobKey = rows[0].blob_key;
    const serialized = await this.blobs.get(blobKey);
    const state = JSON.parse(serialized);
    await this.replaceState(state);
    return state;
  }

  // --- Verification: compare current state to a snapshot ---
  async verify(snapshotId: string): Promise<boolean> {
    const rows = this.db.query(
      `SELECT blob_key FROM snapshots WHERE id = ?`,
      [snapshotId]
    );
    if (rows.length === 0) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    const blobKey = rows[0].blob_key;
    const serialized = await this.blobs.get(blobKey);
    const snapshotState = JSON.parse(serialized);
    const currentState = await this.getState();
    return JSON.stringify(snapshotState) === JSON.stringify(currentState);
  }
}

// --- Singleton agent instance ---
const agent = new SnapshotAgent();

// --- HTTP handler ---
const app = serve(async (req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;
  const path = url.pathname;

  try {
    if (method === 'POST' && path === '/snapshot') {
      const body = await req.json();
      const description = body?.description || '';
      const snapshotId = await agent.snapshot(description);
      return new Response(JSON.stringify({ snapshotId, status: 'created' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'POST' && path.startsWith('/restore/')) {
      const snapshotId = path.split('/')[2];
      const restoredState = await agent.restore(snapshotId);
      return new Response(JSON.stringify({ snapshotId, restoredState }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'GET' && path.startsWith('/verify/')) {
      const snapshotId = path.split('/')[2];
      const isValid = await agent.verify(snapshotId);
      return new Response(JSON.stringify({ snapshotId, valid: isValid }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'GET' && path === '/snapshots') {
      const rows = agent.db.query(`SELECT id, timestamp, description FROM snapshots ORDER BY timestamp DESC`);
      return new Response(JSON.stringify({ snapshots: rows }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Request error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

export default app;
export { SnapshotAgent, agent };
</arg_value>
