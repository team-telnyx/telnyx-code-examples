import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseLiveEnvVars, resolveDemoMode } from "@/server/env";

type SecretValues = Record<string, string>;

const mirror = (values: SecretValues) => ({
  get: async (name: string) => values[name] ?? "",
});

const LIVE_SECRETS: SecretValues = {
  DEMO_MODE: "live",
  TELNYX_CONNECTION_ID: "connection-test",
  TELNYX_ASSISTANT_ID: "assistant-test",
  FROM_NUMBER: "+15555550101",
  STAFF_PHONE: "+15555550102",
  PUBLIC_BASE_URL: "https://demo.example.com",
};

afterEach(() => {
  delete process.env.DEMO_MODE;
  delete process.env.TELNYX_CONNECTION_ID;
  delete process.env.TELNYX_ASSISTANT_ID;
  delete process.env.FROM_NUMBER;
  delete process.env.STAFF_PHONE;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.DEMO_TARGET_PHONE;
});

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = "https://demo.example.com";
});

describe("resolveDemoMode", () => {
  it("defaults to mock with neither source set", async () => {
    expect(await resolveDemoMode(mirror({}))).toBe("mock");
    expect(await resolveDemoMode()).toBe("mock");
  });

  it("goes live from the DEMO_MODE secret even when the env var says mock", async () => {
    process.env.DEMO_MODE = "mock";

    expect(await resolveDemoMode(mirror({ DEMO_MODE: "live" }))).toBe("live");
  });

  it("honors a live process env without any secrets", async () => {
    process.env.DEMO_MODE = "live";

    expect(await resolveDemoMode()).toBe("live");
  });

  it("stays mock when the secret read fails", async () => {
    const broken = {
      get: async () => {
        throw new Error("secret store offline");
      },
    };

    expect(await resolveDemoMode(broken)).toBe("mock");
  });
});

describe("parseLiveEnvVars", () => {
  it("resolves live secrets plus the public base URL", async () => {
    const live = await parseLiveEnvVars(mirror(LIVE_SECRETS));

    expect(live.TELNYX_CONNECTION_ID).toBe("connection-test");
    expect(live.TELNYX_ASSISTANT_ID).toBe("assistant-test");
    expect(live.FROM_NUMBER).toBe("+15555550101");
    expect(live.STAFF_PHONE).toBe("+15555550102");
    expect(live.PUBLIC_BASE_URL).toBe("https://demo.example.com");
  });

  it("lets a set process.env var take precedence over the secret", async () => {
    process.env.FROM_NUMBER = "+15550001111";

    const live = await parseLiveEnvVars(mirror(LIVE_SECRETS));

    expect(live.FROM_NUMBER).toBe("+15550001111");
  });

  it("fails closed listing the missing required vars", async () => {
    await expect(parseLiveEnvVars(mirror({}))).rejects.toThrow(/live mode requires/);
    await expect(parseLiveEnvVars(mirror({}))).rejects.toThrow(/TELNYX_CONNECTION_ID/);
  });

  it("fails closed on a malformed optional phone var", async () => {
    const bad = { ...LIVE_SECRETS, STAFF_PHONE: "not-e164" };

    await expect(parseLiveEnvVars(mirror(bad))).rejects.toThrow(/failed validation/);
  });

  it("requires an explicit live staff phone", async () => {
    const missingStaff = { ...LIVE_SECRETS };
    delete missingStaff.STAFF_PHONE;
    await expect(parseLiveEnvVars(mirror(missingStaff))).rejects.toThrow(/STAFF_PHONE/);
  });
});
