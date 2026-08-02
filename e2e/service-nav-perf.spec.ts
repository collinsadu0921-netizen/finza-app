import { test, expect } from "@playwright/test"
import fs from "fs"
import path from "path"

const creds =
  !!process.env.E2E_SERVICE_EMAIL?.trim() &&
  !!process.env.E2E_SERVICE_PASSWORD?.trim()

type NavMeasurement = {
  route: string
  fetchCount: number
  failedRequests: number
  usefulContentMs: number | null
  shellVisible: boolean
}

const NAV_CHAIN: Array<{ to: string; heading: string | RegExp }> = [
  { to: "/service/invoices", heading: /Invoices/i },
  { to: "/service/payments", heading: /Payments/i },
  { to: "/service/expenses", heading: /Expenses/i },
  { to: "/service/customers", heading: /Customers/i },
  { to: "/service/bills", heading: /Bills|Supplier/i },
]

async function warmNavigate(
  page: import("@playwright/test").Page,
  targetPath: string,
  heading: string | RegExp
): Promise<NavMeasurement> {
  let fetchCount = 0
  let failedRequests = 0

  const onRequest = (req: import("@playwright/test").Request) => {
    if (req.resourceType() === "fetch" || req.resourceType() === "xhr") {
      fetchCount += 1
    }
  }
  const onResponse = (res: import("@playwright/test").Response) => {
    if (
      (res.request().resourceType() === "fetch" || res.request().resourceType() === "xhr") &&
      !res.ok()
    ) {
      failedRequests += 1
    }
  }

  page.on("request", onRequest)
  page.on("response", onResponse)

  const startedAt = Date.now()
  await page.goto(targetPath, { waitUntil: "domcontentloaded" })

  const shellVisible = await page
    .locator("nav, aside")
    .first()
    .isVisible()
    .catch(() => false)

  const headingLocator =
    typeof heading === "string"
      ? page.getByRole("heading", { name: heading })
      : page.getByRole("heading", { name: heading })

  await headingLocator.first().waitFor({ state: "visible", timeout: 60_000 })
  const usefulContentMs = Date.now() - startedAt

  page.off("request", onRequest)
  page.off("response", onResponse)

  return {
    route: targetPath,
    fetchCount,
    failedRequests,
    usefulContentMs,
    shellVisible,
  }
}

test.describe("Service warm navigation performance baseline", () => {
  test.skip(!creds, "Set E2E_SERVICE_EMAIL and E2E_SERVICE_PASSWORD for perf baseline")

  test("record warm navigation chain metrics", async ({ page }) => {
    test.setTimeout(300_000)

    await page.goto("/service/dashboard", { waitUntil: "domcontentloaded" })
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 })

    const results: NavMeasurement[] = []

    for (const step of NAV_CHAIN) {
      const measurement = await warmNavigate(page, step.to, step.heading)
      results.push(measurement)
    }

    const report = {
      capturedAt: new Date().toISOString(),
      baseURL:
        process.env.PLAYWRIGHT_BASE_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://127.0.0.1:3000",
      phase: process.env.PERF_BASELINE_PHASE || "unknown",
      results,
    }

    const outDir = path.join(process.cwd(), "tmp")
    fs.mkdirSync(outDir, { recursive: true })
    const outFile = path.join(outDir, "service-nav-perf-baseline.json")
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2))

    test.info().attach("service-nav-perf-baseline", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    })

    for (const row of results) {
      expect(row.failedRequests).toBe(0)
    }
  })
})
