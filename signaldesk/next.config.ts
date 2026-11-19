import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components opt-out: this app is a real-time operations dashboard and
  // webhook receiver — every page reflects live database state. The previous
  // caching model (force-dynamic) keeps that simple and correct.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
