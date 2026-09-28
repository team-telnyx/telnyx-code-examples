```typescript
// Smoke test — verifies the FrontDesk actor class and its methods exist.
// Run with: npx tsx smoke_test.ts

import { FrontDesk } from "./src/index";

const checks: [string, boolean][] = [
  ["FrontDesk class", typeof FrontDesk === "function"],
  ["initialState method", typeof FrontDesk.prototype.initialState === "function"],
  ["onMessage method", typeof FrontDesk.prototype.onMessage === "function"],
  ["intent method", typeof FrontDesk.prototype.intent === "function"],
  ["findSlots method", typeof FrontDesk.prototype.findSlots === "function"],
  ["book method", typeof FrontDesk.prototype.book === "function"],
  ["remind method", typeof FrontDesk.prototype.remind === "function"],
  ["moveBooking method", typeof FrontDesk.prototype.moveBooking === "function"],
  ["cancelBooking method", typeof FrontDesk.prototype.cancelBooking === "function"],
  ["sendSms method", typeof FrontDesk.prototype.sendSms === "function"],
  ["retrySms method", typeof FrontDesk.prototype.retrySms === "function"],
  ["parseSlotToMs method", typeof FrontDesk.prototype.parseSlotToMs === "function"],
];

let passed = 0;
let failed = 0;

for (const [name, ok] of checks) {
  if (ok) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
```
