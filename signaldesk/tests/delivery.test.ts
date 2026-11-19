import { describe, expect, it } from "vitest";
import { deriveDeliveryStatus } from "../src/lib/delivery";
import { parseRetryAfter } from "../src/lib/telnyx";

describe("delivery status derivation", () => {
  it("maps message.sent to 'sent'", () => {
    expect(deriveDeliveryStatus("message.sent", {})).toBe("sent");
  });

  it("maps clean message.finalized to 'delivered'", () => {
    expect(deriveDeliveryStatus("message.finalized", {})).toBe("delivered");
    expect(
      deriveDeliveryStatus("message.finalized", { errors: [] }),
    ).toBe("delivered");
  });

  it("maps message.finalized with errors to 'failed'", () => {
    expect(
      deriveDeliveryStatus("message.finalized", {
        errors: [{ code: "10100", description: "Device not reachable" }],
      }),
    ).toBe("failed");
  });

  it("parses Retry-After headers", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("nonsense")).toBeNull();
    expect(parseRetryAfter("-5")).toBeNull();
    expect(parseRetryAfter("999999")).toBeLessThanOrEqual(30000);
  });
});
