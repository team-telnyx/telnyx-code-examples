// Telnyx Edge runtime bindings — augmented locally so `npx tsc --noEmit`
// succeeds in a standalone clone. In a real Edge deploy, the runtime generates
// these augmentations from `telnyx.toml` (the `[[actors]]` binding block).
//
// Verified runtime shape:
//   - TRIAGE_ROUTER_V3 → ActorNamespace<TriageRouterV3> (from telnyx.toml)
//   - TELNYX_API_KEY   → string secret (already declared in src/index.ts)
//
// `SMS_FROM_NUMBER` is referenced as an ambient const in the verified source
// (legacy pattern from a previous deploy). Typecheck passes by declaring it
// here; the live runtime injects the value via a deploy-time module-level
// import, not `process.env.SMS_FROM_NUMBER`.

import type { ActorNamespace, ActorStub } from "@telnyx/edge-runtime";

interface TriageRouterV3Stub extends ActorStub {
  logIntent(input: {
    caller: string;
    intent: string;
    note: string;
    call_id?: string;
  }): Promise<void>;
  lastIntentFor(caller: string): Promise<string | null>;
  routes(): Promise<Array<Record<string, unknown>>>;
}

interface TriageRouterV3Namespace extends ActorNamespace {
  idFromName(name: string): TriageRouterV3Stub;
}

declare module "./index.js" {
  interface Env {
    TRIAGE_ROUTER_V3: TriageRouterV3Namespace;
  }
}

declare global {
  const SMS_FROM_NUMBER: string;
}

export {};
