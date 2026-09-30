import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // server-only throws outside React Server Components; tests run in Node.
      "server-only": path.resolve(__dirname, "tests/support/empty.ts"),
      // Better Auth's Next.js cookie plugin imports "next/headers.js"; route it
      // to "next/headers" so the tests' request mock applies.
      "next/headers.js": "next/headers",
    },
  },
  test: {
    environment: "node",
    // Process Better Auth through Vitest so module mocks (next/headers) reach it.
    server: { deps: { inline: [/better-auth/] } },
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/support/setup.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
