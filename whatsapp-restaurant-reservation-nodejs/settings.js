// App settings. Locally they come from .env. On Telnyx Edge, secrets are shared
// by every function in the account, so this app reads only DINENYX_-prefixed
// names there (DINENYX_TELNYX_API_KEY, ...) and never another app's TELNYX_API_KEY.
// Whenever any DINENYX_ variable is set, unprefixed names are ignored entirely.
// Edge functions run on Knative (K_SERVICE); TELNYX_RUNTIME_BINDINGS is only
// there when the function has bindings, and this one may have none.
export const onEdge = () => !!(process.env.TELNYX_RUNTIME_BINDINGS || process.env.K_SERVICE);

const prefixedOnly = () => onEdge() || Object.keys(process.env).some((k) => k.startsWith("DINENYX_"));

export const setting = (name) => process.env[`DINENYX_${name}`] || (prefixedOnly() ? undefined : process.env[name]);
