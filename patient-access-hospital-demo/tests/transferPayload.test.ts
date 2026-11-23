import { describe, expect, it } from "vitest";
import { buildTransferToolConfig, TRANSFER_TARGET_NAME } from "@/domain/transfer";

describe("buildTransferToolConfig", () => {
  it("produces the exact verified Telnyx transfer tool shape", () => {
    const config = buildTransferToolConfig({
      staffNumber: "+15555550188",
      fromNumber: "+15555550100",
      instructions: "Connect the patient to the nurse line.",
    });

    expect(config).toEqual({
      type: "transfer",
      transfer: {
        from: "+15555550100",
        targets: [{ name: TRANSFER_TARGET_NAME, to: "+15555550188" }],
        warm_transfer_instructions: "Connect the patient to the nurse line.",
      },
    });
  });

  it("routes the staff number into targets[0].to", () => {
    const config = buildTransferToolConfig({
      staffNumber: "+15551230000",
      fromNumber: "+15550000001",
      instructions: "any",
    });

    expect(config.transfer.targets[0].to).toBe("+15551230000");
    expect(config.transfer.from).toBe("+15550000001");
  });
});
