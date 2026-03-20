import { test, expect, type Page } from "@playwright/test"

const creds =
  !!process.env.E2E_SERVICE_EMAIL?.trim() &&
  !!process.env.E2E_SERVICE_PASSWORD?.trim()

async function readBusinessIdFromDashboard(page: Page) {
  await page.goto("/service/dashboard")
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 60_000,
  })
  const href = await page.locator('a[href*="business_id="]').first().getAttribute("href")
  if (!href) return null
  try {
    return new URL(href, page.url()).searchParams.get("business_id")
  } catch {
    return null
  }
}

test.describe("Service API smoke (/api/service/*)", () => {
  test.skip(!creds, "Set E2E_SERVICE_EMAIL and E2E_SERVICE_PASSWORD (e.g. in .env.local)")

  test("GET /api/service/expenses/activity returns JSON", async ({ page, request }) => {
    const fromEnv = process.env.E2E_SERVICE_BUSINESS_ID?.trim()
    const businessId = fromEnv || (await readBusinessIdFromDashboard(page))
    test.skip(!businessId, "Could not resolve business_id (set E2E_SERVICE_BUSINESS_ID or ensure dashboard has quick-action links)")

    const res = await request.get(
      `/api/service/expenses/activity?businessId=${encodeURIComponent(businessId)}`
    )
    expect(res.status(), await res.text()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("rows")
  })

  test("GET /api/service/team returns member list for authorized user", async ({ request }) => {
    const res = await request.get("/api/service/team")
    expect([200, 403]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body).toHaveProperty("members")
      expect(Array.isArray(body.members)).toBe(true)
    }
  })
})
