import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ServiceFinancialWriteGate } from "@/components/service/ServiceFinancialWriteGate"

jest.mock("@/components/service/useServiceFinancialWrite", () => ({
  useServiceFinancialWrite: jest.fn(),
}))

import { useServiceFinancialWrite } from "@/components/service/useServiceFinancialWrite"

describe("ServiceFinancialWriteGate", () => {
  it("hides primary mutation content when workspace is read-only", () => {
    ;(useServiceFinancialWrite as jest.Mock).mockReturnValue({
      readOnly: true,
      canWrite: false,
    })

    const html = renderToStaticMarkup(
      <ServiceFinancialWriteGate scope="invoices">
        <button type="button">Create invoice</button>
      </ServiceFinancialWriteGate>
    )

    expect(html).not.toContain("Create invoice")
  })

  it("shows mutation content when writes are allowed", () => {
    ;(useServiceFinancialWrite as jest.Mock).mockReturnValue({
      readOnly: false,
      canWrite: true,
    })

    const html = renderToStaticMarkup(
      <ServiceFinancialWriteGate scope="invoices">
        <button type="button">Create invoice</button>
      </ServiceFinancialWriteGate>
    )

    expect(html).toContain("Create invoice")
  })
})
