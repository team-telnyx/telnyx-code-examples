import { describe, expect, it } from "vitest";
import { readSessionCookie, sessionCookie, clearedSessionCookie } from "@/server/auth";
import { hashPassword, verifyPassword, validateSignup, seedAccount, normalizeEmail } from "@/demo/accounts";

describe("session cookie plumbing", () => {
  it("reads the session cookie from a Cookie header and returns null when absent", () => {
    const withCookie = new Request("http://x/", { headers: { cookie: "other=1; pa_session=abc-def-123" } });
    expect(readSessionCookie(withCookie)).toBe("abc-def-123");
    expect(readSessionCookie(new Request("http://x/"))).toBeNull();
    expect(readSessionCookie(new Request("http://x/", { headers: { cookie: "other=1" } }))).toBeNull();
  });

  it("builds HttpOnly session cookies and clears them", () => {
    const cookie = sessionCookie("tok-1");
    expect(cookie).toContain("pa_session=tok-1");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(clearedSessionCookie()).toContain("Max-Age=0");
  });
});

describe("account hashing and validation", () => {
  it("verifies correct passwords and rejects wrong ones", () => {
    const account = hashPassword("s3cure-passphrase");
    expect(verifyPassword(account, "s3cure-passphrase")).toBe(true);
    expect(verifyPassword(account, "wrong-password")).toBe(false);
  });

  it("hashes are salted per account", () => {
    const a = hashPassword("same");
    const b = hashPassword("same");
    expect(a.hash).not.toBe(b.hash);
    expect(verifyPassword(a, "same")).toBe(true);
    expect(verifyPassword(b, "same")).toBe(true);
  });

  it("validates signups: email shape, password length, confirm match", () => {
    expect(validateSignup({ email: "dr.hospital@example.com", password: "longenough8" })).toEqual({
      ok: true,
      email: "dr.hospital@example.com",
    });
    expect(validateSignup({ email: "not-an-email", password: "longenough8" })).toEqual({ ok: false, error: expect.stringContaining("email") });
    expect(validateSignup({ email: "dr.hospital@example.com", password: "short" })).toEqual({ ok: false, error: expect.stringContaining("8") });
    expect(validateSignup({ email: "dr.hospital@example.com", password: "longenough8", confirm: "different" })).toEqual({
      ok: false,
      error: expect.stringContaining("match"),
    });
    expect(normalizeEmail(" DR.Hospital@Example.COM ")).toBe("dr.hospital@example.com");
  });

  it("seeds the documented demo staff account with working credentials", () => {
    const seed = seedAccount();
    expect(seed.email).toBe("staff@windervalmedical.health");
    expect(seed.password).toBe("winderval-demo");
    expect(verifyPassword(seed, "winderval-demo")).toBe(true);
    expect(verifyPassword(seed, "nope")).toBe(false);
  });
});
