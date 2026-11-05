/* ------------------------------------------------------------------ *
 *  settings.js — Edge-aware configuration                             *
 *  Same pattern as nomad-gateway-nodejs: PHONEID_ prefix for secrets  *
 *  on Telnyx Edge Compute, plain env vars locally.                    *
 * ------------------------------------------------------------------ */

/** True when running inside Telnyx Edge Compute (Knative). */
export const onEdge = () =>
  !!(process.env.TELNYX_RUNTIME_BINDINGS || process.env.K_SERVICE);

/** True when any PHONEID_ prefixed env var exists (Edge or explicit). */
const prefixedOnly = () =>
  onEdge() || Object.keys(process.env).some((k) => k.startsWith("PHONEID_"));

/**
 * Read an env var with automatic prefix handling.
 * On Edge: reads PHONEID_<name> only.
 * Locally:  tries PHONEID_<name> first, falls back to <name>.
 */
export const setting = (name) =>
  process.env[`PHONEID_${name}`] || (prefixedOnly() ? undefined : process.env[name]);
