import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["smoke_test.ts"],
    environment: "node",
  },
});
