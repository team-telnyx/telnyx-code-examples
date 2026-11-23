import { describe, expect, it } from "vitest";
import { MockClinicStore, defaultSeed } from "@/domain/scheduling";
import { fromLocalIso } from "@/domain/slots";

describe("MockClinicStore missed-appointment handling", () => {
  it("starts with a past booked appointment and markMissed() transitions it to missed", () => {
    const store = new MockClinicStore();
    const appointment = store.listAppointments()[0];

    expect(appointment.status).toBe("booked");
    expect(fromLocalIso(appointment.scheduledForIso).getTime()).toBeLessThan(Date.now());

    const marked = store.markMissed();

    expect(marked.status).toBe("missed");
    expect(store.listAppointments()[0].status).toBe("missed");
  });

  it("keeps the seeded appointment visible in the state snapshot seed", () => {
    const seed = defaultSeed();
    expect(seed.appointments.map((a) => a.id)).toContain("apt-001");
    expect(seed.patient.fullName).toBe("Jordan Rivera");
  });

  it("does not mark completed or cancelled appointments as missed", () => {
    const store = new MockClinicStore({
      patient: defaultSeed().patient,
      appointments: [
        { id: "apt-001", patientId: "patient-001", scheduledForIso: "2026-01-01T10:30:00", status: "completed" },
        { id: "apt-002", patientId: "patient-001", scheduledForIso: "2026-01-02T10:30:00", status: "cancelled" },
      ],
      slotSeed: 42,
    });

    const result = store.markMissed();

    expect(result.status).toBe("completed");
    expect(store.listAppointments().map((a) => a.status)).toEqual(["completed", "cancelled"]);
  });
});
