import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // PDF/image/Ghostscript work can be slow on CI machines.
    testTimeout: 30_000,
    // Route tests share in-process rate-limit / job-slot state.
    fileParallelism: false,
  },
})
