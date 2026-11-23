import { z } from "zod";
import type { DemoSettings } from "@/domain/types";

// Demo settings validation. Zod parses external (HTTP) input; defaults allow
// partial updates to resolve to a complete DemoSettings.

export const E164_REGEX = /^\+[1-9]\d{7,14}$/;
export const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const phoneSchema = z.string().regex(E164_REGEX, "must be E.164 (e.g. +15555550123)");
const optionalPhoneSchema = z.preprocess((value) => value === "" ? undefined : value, phoneSchema.optional());
const timeSchema = z.string().regex(HHMM_REGEX, 'must be "HH:MM" in 24h format (e.g. "08:30")');

export const defaultSettings: DemoSettings = {
  callingHours: { start: "08:00", end: "18:00" },
  staffPhoneE164: "+15555550188",
  fromNumberE164: undefined,
  targetPhoneE164: undefined,
};

const settingsSchema = z.object({
  callingHours: z
    .object({ start: timeSchema, end: timeSchema })
    .refine((h) => h.start < h.end, {
      message: "callingHours.start must be before callingHours.end",
    })
    .default(defaultSettings.callingHours),
  staffPhoneE164: phoneSchema.default(defaultSettings.staffPhoneE164),
  fromNumberE164: optionalPhoneSchema,
  targetPhoneE164: optionalPhoneSchema,
});

export function validateSettings(input: unknown): {
  ok: true;
  settings: DemoSettings;
} | { ok: false; errors: string[] } {
  const parsed = settingsSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, settings: parsed.data as DemoSettings };
  }
  const errors = parsed.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "settings";
    return `${path}: ${issue.message}`;
  });
  return { ok: false, errors };
}
