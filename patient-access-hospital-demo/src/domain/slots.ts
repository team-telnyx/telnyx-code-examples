import type { DemoSettings, Slot } from "@/domain/types";

// Slot generation: deterministic, exactly 3 slots, always inside calling hours.
//
// Base plan (adjusted per documented rule: shift into hours; if fewer than
// 3 fit, extend days until 3 are found):
//   - tomorrow 09:00  Dr. A. Chen   (follow-up)
//   - tomorrow 14:00  Dr. A. Chen   (follow-up)
//   - day after tomorrow 10:00  Dr. M. Okafor  (new-patient)

export const SLOT_LENGTH_MINUTES = 30;

type SlotPlan = {
  dayOffset: number;
  hour: number;
  clinicianName: string;
  kind: Slot["kind"];
};

const SLOT_PLANS: SlotPlan[] = [
  { dayOffset: 1, hour: 9, clinicianName: "Dr. A. Chen", kind: "follow-up" },
  { dayOffset: 1, hour: 14, clinicianName: "Dr. A. Chen", kind: "follow-up" },
  { dayOffset: 2, hour: 10, clinicianName: "Dr. M. Okafor", kind: "new-patient" },
];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// The clinic runs on Pacific wall time regardless of the container clock
// (the Edge container is UTC). All labels, availability and matching are
// computed in this zone so Ava never says "10:30 PM" for a morning slot.
const CLINIC_TZ = process.env.CLINIC_TZ || "America/Los_Angeles";

interface PacificParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

export function pacificParts(date: Date): PacificParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  return {
    y: Number(p.year),
    mo: Number(p.month),
    d: Number(p.day),
    h: p.hour === "24" ? 0 : Number(p.hour),
    mi: Number(p.minute),
    s: Number(p.second),
  };
}

function pacificOffsetMinutes(date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: CLINIC_TZ, timeZoneName: "longOffset" });
  const name = dtf.formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "GMT+00:00";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** The UTC instant whose Pacific wall clock is y/m/d h:mi:s (two-pass for DST). */
export function fromPacificParts(y: number, mo: number, d: number, h: number, mi: number, s: number): Date {
  let ts = Date.UTC(y, mo - 1, d, h, mi, s);
  for (let i = 0; i < 2; i++) {
    const adjusted = Date.UTC(y, mo - 1, d, h, mi, s) - pacificOffsetMinutes(new Date(ts)) * 60_000;
    if (adjusted === ts) break;
    ts = adjusted;
  }
  return new Date(ts);
}

export function parseHours(hours: { start: string; end: string }): {
  startMinutes: number;
  endMinutes: number;
} {
  if (!TIME_RE.test(hours.start) || !TIME_RE.test(hours.end)) {
    throw new Error(`invalid calling hours "${hours.start}"/"${hours.end}": expected "HH:MM"`);
  }
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map((part) => Number.parseInt(part, 10));
    return h * 60 + m;
  };
  const startMinutes = toMinutes(hours.start);
  const endMinutes = toMinutes(hours.end);
  if (startMinutes >= endMinutes) {
    throw new Error(`invalid calling hours: start ${hours.start} must be before end ${hours.end}`);
  }
  return { startMinutes, endMinutes };
}

/** Format a Date as a UTC ISO instant WITH Z ("2026-10-29T17:00:00Z") — unambiguous in every browser. */
export function toLocalIso(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}

/** Parse ISO instants — naive values are treated as UTC (matches toLocalIso output). */
export function fromLocalIso(iso: string): Date {
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
}

/** Minutes-of-day for an instant, in the clinic's Pacific wall time. */
export function clinicMinutesOf(date: Date): number {
  const p = pacificParts(date);
  return p.h * 60 + p.mi;
}

/** Add whole clinic-calendar days to an instant, preserving Pacific wall time. */
export function addClinicDays(iso: string, days: number): string {
  const p = pacificParts(fromLocalIso(iso));
  return toLocalIso(fromPacificParts(p.y, p.mo, p.d + days, p.h, p.mi, p.s));
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function atHour(base: Date, hour: number, minute = 0): Date {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function candidateStart(now: Date, dayOffset: number, hour: number, startMinutes: number): Date {
  const np = pacificParts(now);
  const targetDate = fromPacificParts(np.y, np.mo, np.d + dayOffset, hour, startMinutes % 60, 0);
  const cp = pacificParts(targetDate);
  const t = cp.h * 60 + cp.mi;
  if (t < startMinutes) {
    // "shift into hours": pull the start forward to the opening time, same day.
    return fromPacificParts(np.y, np.mo, np.d + dayOffset, Math.floor(startMinutes / 60), startMinutes % 60, 0);
  }
  return targetDate;
}

/** "9:00 AM" / "2:00 PM" (12h clock, Pacific clinic time). */
export function formatTime12(d: Date): string {
  const p = pacificParts(d);
  const h24 = p.h;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(p.mi).padStart(2, "0")} ${suffix}`;
}

/** Full clinic-local date for confirmations; avoids ambiguous relative weekdays. */
export function formatDateLong(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CLINIC_TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function dayDiff(a: Date, b: Date): number {
  const pa = pacificParts(a);
  const pb = pacificParts(b);
  const aDay = Date.UTC(pa.y, pa.mo - 1, pa.d);
  const bDay = Date.UTC(pb.y, pb.mo - 1, pb.d);
  return Math.round((aDay - bDay) / 86_400_000);
}

/** Relative day label: "today", "tomorrow", "yesterday", or a weekday name (Pacific). */
export function relativeDayLabel(d: Date, now: Date = new Date()): string {
  const diff = dayDiff(d, now);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff === 2) return "the day after tomorrow";
  const pp = pacificParts(d);
  return new Intl.DateTimeFormat("en-US", { timeZone: CLINIC_TZ, weekday: "long" }).format(
    new Date(Date.UTC(pp.y, pp.mo - 1, pp.d, 12)),
  );
}

/** Time label for a slot: "tomorrow at 2:00 PM" (no clinician). */
export function slotTimeLabel(slot: Slot, now: Date = new Date()): string {
  const startsAt = fromLocalIso(slot.startsAtIso);
  return `${relativeDayLabel(startsAt, now)} at ${formatTime12(startsAt)}`;
}

/** Offer label: time label plus clinician, e.g. "tomorrow at 2:00 PM with Dr. A. Chen". */
export function slotOfferLabel(slot: Slot, now: Date = new Date()): string {
  return `${slotTimeLabel(slot, now)} with ${slot.clinicianName}`;
}

/**
 * Natural spoken label for the patient's scripted choice, e.g. "Tomorrow at 2 PM".
 * Derives from the real slot so the dialogue stays truthful after settings changes.
 */
export function slotSpeakLabel(slot: Slot, now: Date = new Date()): string {
  const p = pacificParts(fromLocalIso(slot.startsAtIso));
  const suffix = p.h < 12 ? "AM" : "PM";
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  const time = p.mi === 0 ? `${h12} ${suffix}` : `${h12}:${String(p.mi).padStart(2, "0")} ${suffix}`;
  const day = relativeDayLabel(new Date(fromLocalIso(slot.startsAtIso).getTime()), now);
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} at ${time}`;
}

const timeLabelsOf = (slot: Slot, now: Date): { day: string; time: string; shortTime: string; hour: string } => {
  const startsAt = fromLocalIso(slot.startsAtIso);
  const day = relativeDayLabel(startsAt, now).toLowerCase();
  const time = formatTime12(startsAt).toLowerCase();
  const [hour, rest] = time.split(":");
  return { day, time, shortTime: `${hour} ${rest.split(" ")[1]}`, hour };
};

const mentionsSlot = (text: string, slot: Slot, now: Date): boolean => {
  const label = timeLabelsOf(slot, now);
  return text.includes(label.day) && (text.includes(label.time) || text.includes(label.shortTime));
};

/**
 * Time-only mention ("2 PM works", "the 2 o'clock"): books only when the time
 * is unique across the offered slots AND no other slot's day is named — an
 * offer list that names every slot stays ambiguous and can never misbook.
 */
const mentionsExactlyOneTimeAmong = (text: string, slot: Slot, all: Slot[], now: Date): boolean => {
  const label = timeLabelsOf(slot, now);
  const mentioned =
    text.includes(label.time) || text.includes(label.shortTime) || text.includes(`${label.hour} o'clock`);
  if (!mentioned) return false;
  const otherDayNamed = all.some((other) => other.id !== slot.id && text.includes(timeLabelsOf(other, now).day));
  return !otherDayNamed;
};

/** Match a patient utterance ("tomorrow at 2 PM works for me.") to a generated slot. */
export function matchSlotFromUtterance(utterance: string, slots: Slot[], now: Date): Slot {
  const text = utterance.toLowerCase();
  for (const slot of slots) {
    if (mentionsSlot(text, slot, now)) return slot;
  }
  if (!slots[0]) throw new Error("no slots available to match");
  return slots[0];
}

const PICK_ANY_RE = /\b(first|earliest|soonest|any of them|whatever works|anything works)\b/;

/**
 * Booked-slot resolution for live calls: the LAST utterance that names
 * exactly one offered slot (day + time) wins; utterances that name several
 * slots would match offer lists, so they're skipped. "First/earliest" books
 * the earliest slot. Returns null when nothing concrete was chosen — a live
 * call must never book silently.
 */
export function findBookedSlot(utterances: string[], slots: Slot[], now: Date): Slot | null {
  if (slots.length === 0) return null;
  const reversed = [...utterances].reverse();
  for (const utterance of reversed) {
    const text = utterance.toLowerCase();
    const picked = slots.filter((slot) => mentionsSlot(text, slot, now));
    if (picked.length === 1) return picked[0];
    if (picked.length > 1) continue;
    if (PICK_ANY_RE.test(text)) return slots[0];
  }
  for (const utterance of reversed) {
    const text = utterance.toLowerCase();
    const byTime = slots.filter((slot) => mentionsExactlyOneTimeAmong(text, slot, slots, now));
    if (byTime.length === 1) return byTime[0];
  }
  return null;
}

/**
 * Deterministic slot generation. Same (now, settings, seed) always yields the
 * same 3 slots; the seed only feeds slot ids. Every slot starts within calling
 * hours and its 30-minute block fits before hours.end.
 */
export function generateSlots(now: Date, settings: DemoSettings, seed: number): Slot[] {
  const { startMinutes, endMinutes } = parseHours(settings.callingHours);
  const used = new Set<number>();
  const slots: Slot[] = [];

  for (let i = 0; i < SLOT_PLANS.length; i++) {
    const plan = SLOT_PLANS[i];
    let dayOffset = plan.dayOffset;
    let candidate = candidateStart(now, dayOffset, plan.hour, startMinutes);

    // Retry loop: move forward one day (reset to opening time) whenever the
    // candidate is outside calling hours, already taken, or in the past.
    for (let attempt = 0; attempt < 100; attempt++) {
      const cp = pacificParts(candidate);
      const t = cp.h * 60 + cp.mi;
      const fitsHours = t >= startMinutes && t + SLOT_LENGTH_MINUTES <= endMinutes;
      const inFuture = candidate.getTime() > now.getTime();
      const free = !used.has(candidate.getTime());
      if (fitsHours && inFuture && free) break;
      if (attempt === 99) {
        throw new Error(
          `unable to fit 3 slots within calling hours ${settings.callingHours.start}-${settings.callingHours.end}`,
        );
      }
      dayOffset += 1;
      candidate = candidateStart(now, dayOffset, Math.floor(startMinutes / 60), startMinutes);
    }

    used.add(candidate.getTime());
    slots.push({
      id: `slot-${seed}-${i + 1}`,
      startsAtIso: toLocalIso(candidate),
      endsAtIso: toLocalIso(new Date(candidate.getTime() + SLOT_LENGTH_MINUTES * 60_000)),
      clinicianName: plan.clinicianName,
      kind: plan.kind,
    });
  }

  return slots;
}

/**
 * Today-only intake slots (Pacific clinic day): strictly ahead of now with a
 * 15-minute lead, inside Pacific calling hours, spaced an hour apart, max 3.
 * Yields fewer (possibly zero after the last bookable block) rather than
 * crossing days — the book-then-miss narrative must read as "today, you
 * didn't show".
 */
export function generateIntakeSlots(now: Date, settings: DemoSettings, seed: number): Slot[] {
  const { startMinutes, endMinutes } = parseHours(settings.callingHours);
  const slots: Slot[] = [];
  const used = new Set<number>();
  const nowP = pacificParts(now);
  const lead = new Date(now.getTime() + 15 * 60_000);

  const nextHalfHour = (): Date => {
    const d = new Date(now.getTime());
    const mins = d.getMinutes();
    if (mins % 30 !== 0 || d.getSeconds() !== 0) {
      d.setMinutes(mins + (30 - (mins % 30)), 0, 0);
    }
    if (d.getTime() <= now.getTime()) {
      d.setTime(d.getTime() + 30 * 60_000);
    }
    return d;
  };

  let candidate = nextHalfHour();
  for (let attempt = 0; attempt < 48 && slots.length < 3; attempt++) {
    const cp = pacificParts(candidate);
    if (cp.y !== nowP.y || cp.mo !== nowP.mo || cp.d !== nowP.d) break; // today-only (Pacific)
    const t = cp.h * 60 + cp.mi;
    if (t + SLOT_LENGTH_MINUTES > endMinutes) break; // today's capacity exhausted
    const inHours = t >= startMinutes;
    const future = candidate.getTime() >= lead.getTime();
    const free = !used.has(candidate.getTime());
    if (inHours && future && free) {
      used.add(candidate.getTime());
      const plan = SLOT_PLANS[slots.length];
      slots.push({
        id: `slot-intake-${seed}-${slots.length + 1}`,
        startsAtIso: toLocalIso(candidate),
        endsAtIso: toLocalIso(new Date(candidate.getTime() + SLOT_LENGTH_MINUTES * 60_000)),
        clinicianName: plan.clinicianName,
        kind: plan.kind,
      });
      candidate = new Date(candidate.getTime() + 60 * 60_000);
    } else {
      candidate = new Date(candidate.getTime() + 30 * 60_000);
    }
  }

  return slots;
}
