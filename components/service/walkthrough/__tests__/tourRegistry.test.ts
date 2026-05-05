import { describe, it, expect } from "@jest/globals"
import {
  getActiveTourForPath,
  listServiceTourDefinitions,
  normalizeServiceTourPathname,
} from "../tourRegistry"

describe("normalizeServiceTourPathname", () => {
  it("strips query and trailing slash", () => {
    expect(normalizeServiceTourPathname("/service/invoices?business_id=abc")).toBe("/service/invoices")
    expect(normalizeServiceTourPathname("/service/invoices/")).toBe("/service/invoices")
  })
})

describe("getActiveTourForPath", () => {
  it("returns dashboard tour for /service/dashboard", () => {
    const t = getActiveTourForPath("/service/dashboard")
    expect(t?.tourKey).toBe("service.dashboard")
  })

  it("returns active estimates tour for /service/estimates", () => {
    const t = getActiveTourForPath("/service/estimates")
    expect(t?.tourKey).toBe("service.estimates.list")
  })
})

describe("phase 2 tour definitions", () => {
  it("includes expected active Phase 2 tours with route/key/version", () => {
    const defs = listServiceTourDefinitions()
    const expected = [
      { routePattern: "/service/estimates", tourKey: "service.estimates.list", tourVersion: 1 },
      { routePattern: "/service/payments", tourKey: "service.payments.list", tourVersion: 1 },
      { routePattern: "/service/proforma", tourKey: "service.proformas.list", tourVersion: 1 },
      { routePattern: "/service/proposals", tourKey: "service.proposals.list", tourVersion: 1 },
      { routePattern: "/service/expenses", tourKey: "service.expenses.list", tourVersion: 1 },
      { routePattern: "/service/credit-notes", tourKey: "service.credit_notes.list", tourVersion: 1 },
      {
        routePattern: "/service/incoming-documents",
        tourKey: "service.incoming_documents.list",
        tourVersion: 1,
      },
    ]
    for (const e of expected) {
      const t = defs.find((d) => d.tourKey === e.tourKey)
      expect(t).toBeDefined()
      expect(t?.active).toBe(true)
      expect(t?.routePattern).toBe(e.routePattern)
      expect(t?.tourVersion).toBe(e.tourVersion)
      expect((t?.steps.length ?? 0) > 0).toBe(true)
    }
  })

  it("enforces valid data-tour selector format for active Phase 2 tours", () => {
    const defs = listServiceTourDefinitions().filter(
      (d) =>
        d.active &&
        [
          "service.estimates.list",
          "service.payments.list",
          "service.proformas.list",
          "service.proposals.list",
          "service.expenses.list",
          "service.credit_notes.list",
          "service.incoming_documents.list",
        ].includes(d.tourKey)
    )

    for (const d of defs) {
      expect(d.steps.length).toBeGreaterThan(0)
      for (const s of d.steps) {
        expect(s.targetSelector).toMatch(/^\[data-tour="[^"]+"\]$/)
      }
    }
  })
})

describe("phase 3 tour definitions", () => {
  it("includes expected active Phase 3 tours with route/key/version", () => {
    const defs = listServiceTourDefinitions()
    const expected = [
      { routePattern: "/service/settings", tourKey: "service.settings.index", tourVersion: 1 },
      { routePattern: "/service/settings/payments", tourKey: "service.settings.payment_details", tourVersion: 1 },
      { routePattern: "/service/settings/invoice-settings", tourKey: "service.settings.documents", tourVersion: 1 },
      { routePattern: "/service/settings/team", tourKey: "service.settings.users", tourVersion: 1 },
      { routePattern: "/service/settings/subscription", tourKey: "service.subscription", tourVersion: 1 },
      { routePattern: "/service/settings/inbound-email", tourKey: "service.settings.inbound_email", tourVersion: 1 },
    ]
    for (const e of expected) {
      const t = defs.find((d) => d.tourKey === e.tourKey)
      expect(t).toBeDefined()
      expect(t?.active).toBe(true)
      expect(t?.routePattern).toBe(e.routePattern)
      expect(t?.tourVersion).toBe(e.tourVersion)
      expect((t?.steps.length ?? 0) > 0).toBe(true)
    }
  })

  it("enforces valid data-tour selector format for active Phase 3 tours", () => {
    const defs = listServiceTourDefinitions().filter(
      (d) =>
        d.active &&
        [
          "service.settings.index",
          "service.settings.payment_details",
          "service.settings.documents",
          "service.settings.users",
          "service.subscription",
          "service.settings.inbound_email",
        ].includes(d.tourKey)
    )

    for (const d of defs) {
      expect(d.steps.length).toBeGreaterThan(0)
      for (const s of d.steps) {
        expect(s.targetSelector).toMatch(/^\[data-tour="[^"]+"\]$/)
      }
    }
  })
})
