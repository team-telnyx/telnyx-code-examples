import { defineConfig } from "vitest/config";
import path from "node:path";
import { config as loadEnv } from "dotenv";

// Load .env before tests import DB-touching modules.
loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true });

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` throws outside Next.js; stub it for unit tests.
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
  },
});
