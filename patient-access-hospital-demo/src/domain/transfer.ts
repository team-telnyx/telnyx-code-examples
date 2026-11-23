import type { PhoneE164 } from "@/domain/types";
import { brandName } from "@/domain/brand";

// Warm-transfer tool configuration. This output shape is the EXACT verified
// Telnyx transfer tool payload — do not alter keys or nesting.

export type TransferToolConfig = {
  type: "transfer";
  transfer: {
    from: PhoneE164;
    targets: Array<{ name: string; to: PhoneE164 }>;
    warm_transfer_instructions: string;
  };
};

export const TRANSFER_TARGET_NAME = `${brandName()} Staff Line`;

export function buildTransferToolConfig(input: {
  staffNumber: PhoneE164;
  fromNumber: PhoneE164;
  instructions: string;
}): TransferToolConfig {
  return {
    type: "transfer",
    transfer: {
      from: input.fromNumber,
      targets: [{ name: TRANSFER_TARGET_NAME, to: input.staffNumber }],
      warm_transfer_instructions: input.instructions,
    },
  };
}
