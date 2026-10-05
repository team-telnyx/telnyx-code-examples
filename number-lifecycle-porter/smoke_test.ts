```typescript
// Smoke test for number-lifecycle-porter
// Run with: npx tsx smoke_test.ts

import { NumberActor } from './src/index';

// Verify class exists
if (!NumberActor) {
  console.error('FAIL: NumberActor is not exported');
  process.exit(1);
}
console.log('✅ NumberActor class exported');

// Verify methods exist
const methods = ['provision', 'rollback', 'retire', 'pollOrder', 'fetch', 'initialState'];
for (const method of methods) {
  if (typeof (NumberActor.prototype as any)[method] !== 'function') {
    console.error(`FAIL: NumberActor.prototype.${method} is not a function`);
    process.exit(1);
  }
  console.log(`✅ NumberActor.prototype.${method} exists`);
}

// Verify default export
async function verifyDefaultExport() {
  const mod = await import('./src/index');
  if (!mod.default || typeof mod.default.fetch !== 'function') {
    console.error('FAIL: default export does not have fetch handler');
    process.exit(1);
  }
  console.log('✅ Default fetch handler exported');
}

verifyDefaultExport().then(() => {
  console.log('\n✅ All smoke tests passed!');
}).catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
```
