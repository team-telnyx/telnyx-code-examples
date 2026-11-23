import type { DemoState } from "@/domain/types";

// Deterministic sample state for frontend development and review.
// Fixed dates keep the fixture stable; the live demo generates slots
// relative to "now" instead. All data is synthetic.

const MISSED_APPOINTMENT_ISO = "2026-10-27T10:30:00";
const SLOT_1_START = "2026-10-29T09:00:00";
const SLOT_2_START = "2026-10-29T14:00:00";
const SLOT_3_START = "2026-10-30T10:00:00";

const isoEnd = (start: string, minutes = 30) => {
  const d = new Date(start);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().replace("Z", "");
};

export const fixtureDemoState: DemoState = {
  mode: "mock",
  patient: {
    id: "patient-001",
    fullName: "Jordan Rivera",
    mrn: "MRN-004512",
    dobIso: "1978-03-14",
    phoneE164: "+15555550123",
  },
  appointments: [
    {
      id: "apt-001",
      patientId: "patient-001",
      scheduledForIso: MISSED_APPOINTMENT_ISO,
      status: "missed",
      reason: "Patient did not arrive",
    },
  ],
  availableSlots: [
    {
      id: "slot-1",
      startsAtIso: SLOT_1_START,
      endsAtIso: isoEnd(SLOT_1_START),
      clinicianName: "Dr. A. Chen",
      kind: "follow-up",
    },
    {
      id: "slot-2",
      startsAtIso: SLOT_2_START,
      endsAtIso: isoEnd(SLOT_2_START),
      clinicianName: "Dr. A. Chen",
      kind: "follow-up",
    },
    {
      id: "slot-3",
      startsAtIso: SLOT_3_START,
      endsAtIso: isoEnd(SLOT_3_START),
      clinicianName: "Dr. M. Okafor",
      kind: "new-patient",
    },
  ],
  calls: [],
  sms: [],
  escalations: [],
  settings: {
    callingHours: { start: "08:00", end: "18:00" },
    staffPhoneE164: "+15555550188",
    fromNumberE164: undefined,
    targetPhoneE164: undefined,
  },
  phase: "idle",
  updatedAtIso: new Date(0).toISOString(),
};
