// The demo brand resolves from BRAND_NAME (telnyx.toml env_vars / environment).
// Default is a fully invented clinic brand, verified unique against real
// healthcare entities during the build.

export function brandName(): string {
  return (process.env.BRAND_NAME ?? "").trim() || "Winderval Medical";
}
