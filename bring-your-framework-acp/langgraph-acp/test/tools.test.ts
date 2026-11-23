import { describe, expect, it } from "vitest";
import { extractOrderId, lookupOrder } from "../src/tools.js";

describe("demo order tool", () => {
  it("returns deterministic data for the recording order", () => {
    expect(lookupOrder("ORD-10042")).toEqual({
      orderId: "ORD-10042",
      status: "shipped",
      eta: "Friday",
      carrier: "Telnyx Logistics",
    });
  });

  it("normalizes order IDs from natural language", () => {
    expect(extractOrderId("Where is order ord 10042?")).toBe("ORD-10042");
  });

  it("returns an explicit not-found result", () => {
    expect(lookupOrder("ORD-99999").status).toBe("not_found");
  });
});

