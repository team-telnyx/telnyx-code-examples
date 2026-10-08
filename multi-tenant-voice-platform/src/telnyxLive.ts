import type { Env, Tenant } from "./types.js";

/**
 * Live Telnyx Call Control wrapper.
 *
 * In LIVE_MODE (TELNYX_API_KEY set, DEMO_MODE=false), the place-call
 * handler invokes telnyx.calls.create() and stores the returned
 * `call_control_id`. The webhook receiver then updates call state from
 * the real `call.initiated` / `call.answered` / `call.hangup` events.
 *
 * In DEMO_MODE this module is unused — the seeder / handler generates
 * simulated call_control_ids and walks the call through its states on
 * a timer.
 */
export type LivePlaceArgs = {
  tenant: Tenant;
  from_number: string;
  to_number: string;
};

export type LivePlaceResult = {
  call_control_id: string;
  raw: unknown;
};

export class TelnyxLiveClient {
  private telnyx: { calls: { create: (args: Record<string, unknown>) => Promise<{ data: { id: string; call_control_id?: string } }> } };

  constructor(apiKey: string) {
    // Lazy-import to avoid loading the SDK in DEMO_MODE.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { default: Telnyx } = require("telnyx");
    this.telnyx = new Telnyx({ apiKey, maxRetries: 0, timeout: 10000 }) as unknown as {
      calls: { create: (args: Record<string, unknown>) => Promise<{ data: { id: string; call_control_id?: string } }> };
    };
  }

  /**
   * Place a real outbound call via the Telnyx Call Control API.
   * Throws on any non-2xx — the caller is responsible for surfacing the
   * error to the dashboard.
   */
  async placeCall(args: LivePlaceArgs): Promise<LivePlaceResult> {
    const params: Record<string, unknown> = {
      from: args.from_number,
      to: args.to_number,
      connection_id: args.tenant.default_voice_profile_id || undefined,
    };
    const res = await this.telnyx.calls.create(params);
    const callControlId = res.data?.call_control_id ?? res.data?.id ?? "";
    return { call_control_id: callControlId, raw: res };
  }
}

/** Type guard for whether the live client is wired (DEMO_MODE=false + API key). */
export function isLiveMode(env: Pick<Env, "LIVE_MODE" | "TELNYX_API_KEY"> | Record<string, unknown>): boolean {
  const e = env as Record<string, unknown>;
  return !e.DEMO_MODE && Boolean(e.TELNYX_API_KEY);
}
