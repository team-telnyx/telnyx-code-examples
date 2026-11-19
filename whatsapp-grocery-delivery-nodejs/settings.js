// App settings. Locally they come from .env. On Telnyx Edge, secrets are shared
// by every function in the account, so this app reads only FRESHCART_-prefixed
// names there (FRESHCART_TELNYX_API_KEY, ...) and never another app's TELNYX_API_KEY.
// Whenever any FRESHCART_ variable is set, unprefixed names are ignored entirely.
export const onEdge = () => !!(process.env.TELNYX_RUNTIME_BINDINGS || process.env.K_SERVICE);

const prefixedOnly = () => onEdge() || Object.keys(process.env).some((k) => k.startsWith("FRESHCART_"));

export const setting = (name) => process.env[`FRESHCART_${name}`] || (prefixedOnly() ? undefined : process.env[name]);
