import { test as setup, expect } from "@playwright/test"
import path from "path"
import fs from "fs"

const authFile = path.join(__dirname, ".auth", "service.json")

setup.describe.configure({ mode: "serial" })

setup("authenticate service workspace", async ({ page }) => {
  const email = process.env.E2E_SERVICE_EMAIL?.trim()
  const password = process.env.E2E_SERVICE_PASSWORD?.trim()
  if (!email || !password) {
    throw new Error("E2E_SERVICE_EMAIL and E2E_SERVICE_PASSWORD must be set for the setup project")
  }

  fs.mkdirSync(path.dirname(authFile), { recursive: true })

  await page.goto("/login")
  await page.locator("#email").fill(email)
  await page.locator("#password").fill(password)

  await page.getByRole("button", { name: "Sign in" }).click()
  // Home (/) is transient after login; wait for a stable post-auth destination.
  await page.waitForURL(
    (url) => {
      const p = url.pathname
      return (
        p.startsWith("/service/dashboard") ||
        p === "/select-workspace" ||
        p.startsWith("/retail/dashboard")
      )
    },
    { timeout: 90_000 }
  )

  if (page.url().includes("select-workspace")) {
    const nameHint = process.env.E2E_SERVICE_BUSINESS_NAME?.trim()
    if (nameHint) {
      await page.getByRole("button", { name: new RegExp(nameHint, "i") }).click()
    } else {
      const serviceCard = page
        .getByRole("button")
        .filter({ has: page.getByText("Service", { exact: true }) })
        .first()
      await expect(serviceCard).toBeVisible({ timeout: 15_000 })
      await serviceCard.click()
    }
    await page.waitForURL(/\/service\/dashboard/, { timeout: 60_000 })
  }

  await expect(page).toHaveURL(/\/service\/dashboard/)

  await page.context().storageState({ path: authFile })
})
