import { defineConfig } from "vite";

export default defineConfig({
  esbuild: {
    // Lower TC39 decorators to plain JS for the vite-node SSR transform
    // (an esnext target passes them through raw, which Node's vm cannot parse).
    target: "es2022",
  },
});
