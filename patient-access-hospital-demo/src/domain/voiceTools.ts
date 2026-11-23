import type { Slot } from "@/domain/types";

/** Inline Telnyx AI Assistant webhook tool configuration. */
export type RescheduleToolConfig = {
  type: "webhook";
  webhook: {
    name: "reschedule_clinic_appointment";
    description: string;
    url: string;
    method: "POST";
    async: false;
    timeout_ms: number;
    body_parameters: {
      type: "object";
      required: ["patient_name", "date_of_birth", "new_time"];
      properties: Record<string, { type: string; description: string }>;
    };
  };
};

export function buildRescheduleToolConfig(url: string): RescheduleToolConfig {
  return {
    type: "webhook",
    webhook: {
      name: "reschedule_clinic_appointment",
      description:
        "After the patient explicitly confirms one offered slot, update the current appointment and send the confirmation SMS. Use only the current patient context and offered slot.",
      url,
      method: "POST",
      async: false,
      timeout_ms: 5000,
      body_parameters: {
        type: "object",
        required: ["patient_name", "date_of_birth", "new_time"],
        properties: {
          patient_name: { type: "string", description: "The verified patient's full name." },
          date_of_birth: { type: "string", description: "The verified patient's date of birth in YYYY-MM-DD format." },
          new_time: { type: "string", description: "The exact date and time the patient explicitly confirmed." },
          slot_id: { type: "string", description: "The selected slot ID when present in the current offer." },
          call_control_id: { type: "string", description: "The active call control ID when available." },
        },
      },
    },
  };
}

export function slotMatchesToolInput(input: { slotId?: string; newTime?: string }, slots: Slot[], find: (text: string, candidates: Slot[]) => Slot | null): Slot | null {
  if (input.slotId) return slots.find((slot) => slot.id === input.slotId) ?? null;
  const newTime = (input.newTime ?? "").trim();
  return newTime ? find(newTime, slots) : null;
}
