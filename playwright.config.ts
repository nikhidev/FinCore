import {defineConfig} from "@playwright/test";

export default defineConfig({
  testDir:"./e2e",
  timeout:30_000,
  use:{
    baseURL:process.env.FINCORE_PREVIEW_URL || "http://127.0.0.1:3000",
    channel:process.env.FINCORE_BROWSER_CHANNEL || undefined,
    trace:"retain-on-failure",
  },
});
