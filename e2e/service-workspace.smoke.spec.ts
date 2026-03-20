import { test, expect } from "@playwright/test"

const creds =
  !!process.env.E2E_SERVICE_EMAIL?.trim() &&
  !!process.env.E2E_SERVICE_PASSWORD?.trim()

test.describe("Service workspace UI smoke", () => {
  test.skip(!creds, "Set E2E_SERVICE_EMAIL and E2E_SERVICE_PASSWORD (e.g. in .env.local)")

  test("dashboard shows business heading", async ({ page }) => {
    await page.goto("/service/dashboard")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 60_000,
    })
  })

  test("customers list page loads", async ({ page }) => {
    await page.goto("/service/customers")
    await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible({
      timeout: 60_000,
    })
  })

  test("new invoice page loads", async ({ page }) => {
    await page.goto("/service/invoices/new")
    await expect(page.getByRole("heading", { name: "New Invoice" })).toBeVisible({
      timeout: 60_000,
    })
  })

  test("profit and loss report loads", async ({ page }) => {
    await page.goto("/service/reports/profit-and-loss")
    await expect(page.getByRole("heading", { name: "Profit & Loss" })).toBeVisible({
      timeout: 60_000,
    })
  })
})
