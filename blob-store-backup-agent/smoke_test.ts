import { describe, it, expect } from 'vitest';

describe('BlobStore Backup Agent', () => {
  it('should load the main module without error', async () => {
    const mod = await import('../src/index');
    expect(mod).toBeDefined();
    expect(mod.default).toBeDefined();
  });
});
</arg_value>
