import { defineConfig, devices } from "@playwright/test"
import path from "path"
import dotenv from "dotenv"

dotenv.config({ path: path.join(__dirname, ".env.local") })
dotenv.config()

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  "http://127.0.0.1:3000"

const authFile = path.join(__dirname, "e2e", ".auth", "service.json")
const e2eCreds = Boolean(
  process.env.E2E_SERVICE_EMAIL?.trim() &&
    process.env.E2E_SERVICE_PASSWORD?.trim()
)

const chromiumProject = {
  name: "chromium" as const,
  testMatch: /.*\.spec\.ts/,
  testIgnore: /service-auth\.setup\.ts/,
  use: {
    ...devices["Desktop Chrome"],
    ...(e2eCreds ? { storageState: authFile } : {}),
  },
  ...(e2eCreds ? { dependencies: ["setup" as const] } : {}),
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: e2eCreds
    ? [{ name: "setup", testMatch: /service-auth\.setup\.ts/ }, chromiumProject]
    : [chromiumProject],
  // Only boot Next when credentials are present; otherwise specs are skipped and no server is needed.
  ...(e2eCreds
    ? {
        webServer: {
          command: "npm run dev",
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }
    : {}),
})
