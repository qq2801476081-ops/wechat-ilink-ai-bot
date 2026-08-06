import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2026-08-06",
        d1Databases: ["DB"],
        bindings: {
          BOT_STATE_ENC_KEY: "0123456789abcdef0123456789abcdef",
          ILINK_BASE_URL: "https://ilink.example.test"
        }
      }
    })
  ],
  test: {
    coverage: {
      enabled: false
    }
  }
});
