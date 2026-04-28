"use client"

import { createContext, useContext, type ReactNode } from "react"

const DEFAULT_PAYROLL_BASE_PATH = "/payroll"

const PayrollBasePathContext = createContext<string>(DEFAULT_PAYROLL_BASE_PATH)

export function PayrollBasePathProvider({
  basePath,
  children,
}: {
  basePath: string
  children: ReactNode
}) {
  return <PayrollBasePathContext.Provider value={basePath}>{children}</PayrollBasePathContext.Provider>
}

/** Base path for payroll UI routes: `/payroll` (standalone) or `/service/payroll` (Service workspace). */
export function usePayrollBasePath() {
  return useContext(PayrollBasePathContext)
}
