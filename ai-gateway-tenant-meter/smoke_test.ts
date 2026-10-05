```typescript
import { describe, it, expect } from "vitest";
import { SpendLedger } from "./src/index";

describe("SpendLedger actor", () => {
  it("should be a class", () => {
    expect(SpendLedger).toBeDefined();
    expect(typeof SpendLedger).toBe("function");
  });

  it("should have provision RPC method", () => {
    const proto = SpendLedger.prototype;
    expect(typeof proto.provision).toBe("function");
  });

  it("should have spendView RPC method", () => {
    const proto = SpendLedger.prototype;
    expect(typeof proto.spendView).toBe("function");
  });

  it("should have rollup method", () => {
    const proto = SpendLedger.prototype;
    expect(typeof proto.rollup).toBe("function");
  });

  it("should have fetch handler", () => {
    const proto = SpendLedger.prototype;
    expect(typeof proto.fetch).toBe("function");
  });

  it("should have initialState method", () => {
    const proto = SpendLedger.prototype;
    expect(typeof proto.initialState).toBe("function");
  });
});

describe("Module exports", () => {
  it("should export SpendLedger", () => {
    expect(SpendLedger).toBeDefined();
  });

  it("should export default fetch handler", async () => {
    const mod = await import("./src/index");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.fetch).toBe("function");
  });
});
```
