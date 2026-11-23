import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Account logic for the demo portal: synthetic staff accounts stored in the
// AccountsActor's durable state. Passwords are salted+scrypt-hashed and never
// leave the actor.

export type AccountRecord = {
  email: string;
  salt: string;
  hash: string;
  createdAtIso: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type SignupCheck = { ok: true; email: string } | { ok: false; error: string };

export function validateSignup(input: { email: string; password: string; confirm?: string }): SignupCheck {
  const email = normalizeEmail(input.email ?? "");
  if (typeof input.email !== "string" || !EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (typeof input.password !== "string" || input.password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (input.confirm !== undefined && input.confirm !== input.password) {
    return { ok: false, error: "Passwords do not match." };
  }
  return { ok: true, email };
}

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return { salt, hash };
}

export function verifyPassword(account: { salt: string; hash: string }, password: string): boolean {
  try {
    const candidate = scryptSync(password, account.salt, 32);
    const stored = Buffer.from(account.hash, "hex");
    if (candidate.length !== stored.length) return false;
    return timingSafeEqual(candidate, stored);
  } catch {
    return false;
  }
}

/** Deterministic seeded-account credentials for cloning/demo (documented in README). */
export function seedAccount(): AccountRecord & { password: string } {
  const password = process.env.DEMO_LOGIN_PASSWORD ?? "winderval-demo";
  const email = normalizeEmail(process.env.DEMO_LOGIN_EMAIL ?? "staff@windervalmedical.health");
  const derived = hashPassword(password);
  return { email, salt: derived.salt, hash: derived.hash, createdAtIso: new Date(0).toISOString(), password };
}

export function accountFingerprint(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 8);
}
