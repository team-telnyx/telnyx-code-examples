import { describe, it, expect } from 'vitest';

describe('agent-state-snapshot-restore smoke test', () => {
  it('should import the main module without error', async () => {
    const mod = await import('./src/index.ts');
    expect(mod).toBeDefined();
    expect(mod.default).toBeDefined();
    expect(mod.SnapshotAgent).toBeDefined();
    expect(mod.agent).toBeDefined();
  });

  it('should instantiate SnapshotAgent with StateStore, BlobStore, and SqlDatabase', async () => {
    const { SnapshotAgent } = await import('./src/index.ts');
    const agent = new SnapshotAgent();
    expect(agent).toBeDefined();
    expect(agent.blobs).toBeDefined();
    expect(agent.db).toBeDefined();
    expect(typeof agent.snapshot).toBe('function');
    expect(typeof agent.restore).toBe('function');
    expect(typeof agent.verify).toBe('function');
  });
});
</arg_value>
