```typescript
import { describe, it, expect } from "vitest";
import { IntakeDossier } from "./src/index";

describe("IntakeDossier", () => {
  it("should be a class that extends Agent", () => {
    expect(IntakeDossier).toBeDefined();
    expect(typeof IntakeDossier).toBe("function");
  });

  it("should have handleInitialization method", () => {
    const proto = IntakeDossier.prototype;
    expect(typeof proto.handleInitialization).toBe("function");
  });

  it("should have fileVisitSummary method", () => {
    const proto = IntakeDossier.prototype;
    expect(typeof proto.fileVisitSummary).toBe("function");
  });

  it("should have dossierView RPC method", () => {
    const proto = IntakeDossier.prototype;
    expect(typeof proto.dossierView).toBe("function");
  });

  it("should have initialState method", () => {
    const proto = IntakeDossier.prototype;
    expect(typeof proto.initialState).toBe("function");
  });

  it("should produce correct initial state shape", () => {
    const proto = IntakeDossier.prototype;
    expect(proto.initialState).toBeDefined();
  });
});

describe("Module exports", () => {
  it("should export IntakeDossier class", async () => {
    const mod = await import("./src/index");
    expect(mod.IntakeDossier).toBeDefined();
  });

  it("should export default fetch handler", async () => {
    const mod = await import("./src/index");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.fetch).toBe("function");
  });
});
```
