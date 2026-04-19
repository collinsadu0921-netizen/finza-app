"use client"

import { Suspense, createContext, useContext, useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter, usePathname } from "next/navigation"
import { ServiceSubscriptionProvider } from "@/components/service/ServiceSubscriptionContext"
import StoreSwitcher from "./StoreSwitcher"
import Sidebar from "./Sidebar"
import { isCashierAuthenticated } from "@/lib/cashierSession"
import { resolveAccess, isPosSurfacePath } from "@/lib/accessControl"
import { getUserRole } from "@/lib/userRoles"
import { autoBindSingleStore } from "@/lib/autoBindStore"
import { useExportMode } from "@/lib/hooks/useExportMode"
import RetailPosIdleSessionWatcher from "@/components/RetailPosIdleSessionWatcher"
import AppIdleTimeoutWatcher from "@/components/AppIdleTimeoutWatcher"
import { getCurrentBusiness } from "@/lib/business"
import AiAssistant from "@/components/AiAssistant"
import {
  WorkspaceBusinessProvider,
  type WorkspaceBusiness,
  type WorkspaceSessionUser,
} from "@/components/WorkspaceBusinessContext"
import PlatformAnnouncementsHost from "@/components/platform/PlatformAnnouncementsHost"

const ProtectedLayoutContext = createContext(false)

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const isNestedProtectedLayout = useContext(ProtectedLayoutContext)
  const router = useRouter()
  const pathname = usePathname()
  const [loading, setLoading] = useState(isNestedProtectedLayout ? false : true)
  const [aiBusinessId, setAiBusinessId] = useState<string | null>(null)
  const [aiContext, setAiContext] = useState<Record<string, unknown> | null>(null)
  const [aiContextRefreshKey, setAiContextRefreshKey] = useState(0)
  const [workspaceBusiness, setWorkspaceBusiness] = useState<WorkspaceBusiness>(null)
  const [workspaceSessionUser, setWorkspaceSessionUser] = useState<WorkspaceSessionUser>(null)
  /** DB role cashier on a retail business — hide owner sidebar/nav (parallel to PIN session chrome). */
  const [restrictRetailCashierChrome, setRestrictRetailCashierChrome] = useState(false)
  const [cashierSessionBump, setCashierSessionBump] = useState(0)
  /** Bumped when pathname / cashier bump changes so in-flight checkAccess can bail (avoids stale state + UI flicker). */
  const layoutAccessEpochRef = useRef(0)
  const isExportMode = useExportMode()
  const isPOSRoute = isPosSurfacePath(pathname ?? "")
  const cashierAuth = isCashierAuthenticated()
  /** Cashier PIN entry — no session yet, so still hide owner shell (kiosk / shared register). */
  const rawPath = pathname?.split("?")[0] ?? ""
  const pathNoTrailing = rawPath.replace(/\/$/, "") || "/"
  const isRetailCashierPinScreen =
    pathNoTrailing === "/retail/pos/pin" || pathNoTrailing === "/pos/pin"
  /** Hide sidebar + top bar: active PIN session, DB cashier role, or cashier PIN login route */
  const hideRetailOwnerChrome =
    cashierAuth || restrictRetailCashierChrome || isRetailCashierPinScreen
  /** Hide floating assistant on POS paths and whenever retail cashier / PIN session uses the restricted shell */
  const hideFloatingAssistant =
    pathname?.startsWith("/retail/pos") ||
    pathname?.startsWith("/pos/") ||
    hideRetailOwnerChrome
  const isAccountingRoute = pathname?.startsWith("/accounting")

  useEffect(() => {
    // Nested usage should be a transparent wrapper to prevent duplicate chrome.
    if (isNestedProtectedLayout) {
      if (loading) setLoading(false)
      return
    }

    const epoch = ++layoutAccessEpochRef.current
    let isMounted = true

    const stale = () => !isMounted || layoutAccessEpochRef.current !== epoch

    async function checkAccess() {
      // CENTRALIZED ACCESS CONTROL: Single source of truth for all access decisions
      // This function evaluates ALL conditions (auth, role, workspace, route, store) in ONE place
      // Redirects happen HERE ONLY - no other guards should redirect
      
      console.log("ProtectedLayout: Resolving access for", pathname)
      
      // Get user ID from session
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      
      if (stale()) return
      
      if (sessionError) {
        console.error("ProtectedLayout: Session error:", sessionError)
        if (stale()) return
        setLoading(false)
        router.push("/login")
        return
      }
      
      const userId = sessionData?.session?.user?.id || null
      
      // STORE CONTEXT AUTO-BIND: Auto-set activeStoreId if user has exactly one store
      // This prevents unnecessary redirects to /select-store for single-store users
      if (userId) {
        await autoBindSingleStore(supabase, userId)
      }

      if (stale()) return
      
      // CENTRALIZED ACCESS RESOLUTION: Single function makes ALL access decisions
      const decision = await resolveAccess(supabase, userId, pathname || "")
      
      if (stale()) return
      
      if (typeof window !== "undefined" && process.env.NODE_ENV === "development" && pathname?.startsWith("/accounting")) {
        console.log("[ProtectedLayout] accounting decision", { allowed: decision.allowed, redirectTo: decision.redirectTo, reason: decision.reason })
      }
      
      if (!decision.allowed) {
        // SINGLE REDIRECT POINT: All redirects happen here only
        if (stale()) return
        const redirectTo = decision.redirectTo || "/login"
        console.log(`ProtectedLayout: Access denied (${decision.reason}), redirecting to ${redirectTo}`)
        setRestrictRetailCashierChrome(false)
        setLoading(false)
        router.push(redirectTo)
        return
      }

      if (userId) {
        try {
          const business = await getCurrentBusiness(supabase, userId)
          if (stale()) return
          setAiBusinessId(business?.id || null)
          setWorkspaceBusiness((business as WorkspaceBusiness) ?? null)
          setWorkspaceSessionUser(
            sessionData?.session?.user
              ? {
                  id: sessionData.session.user.id,
                  email: sessionData.session.user.email,
                  user_metadata: sessionData.session.user.user_metadata,
                }
              : null
          )
          let restrictChrome = false
          if (business?.id && (business.industry || "").toLowerCase() === "retail") {
            const role = await getUserRole(supabase, userId, business.id)
            restrictChrome = role === "cashier"
          }
          if (!stale()) setRestrictRetailCashierChrome(restrictChrome)
        } catch (error) {
          console.error("ProtectedLayout: Failed to resolve business for AI context", error)
          if (!stale()) {
            setAiBusinessId(null)
            setWorkspaceBusiness(null)
            setWorkspaceSessionUser(null)
            setRestrictRetailCashierChrome(false)
          }
        }
      } else if (!stale()) {
        setWorkspaceBusiness(null)
        setWorkspaceSessionUser(null)
        setRestrictRetailCashierChrome(false)
      }
      
      if (stale()) return
      console.log("ProtectedLayout: Access granted")
      setLoading(false)
    }
    
    checkAccess()
    
    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false
    }
    // Note: do not depend on `loading` — setting loading false here would re-fire this effect and re-run
    // resolveAccess + getUserRole, which caused visible retail UI flicker.
  }, [router, pathname, isNestedProtectedLayout, cashierSessionBump])

  useEffect(() => {
    if (typeof window === "undefined") return
    const onCashierSession = () => setCashierSessionBump((n) => n + 1)
    window.addEventListener("cashierSessionChanged", onCashierSession)
    return () => window.removeEventListener("cashierSessionChanged", onCashierSession)
  }, [])

  useEffect(() => {
    if (isNestedProtectedLayout || !aiBusinessId) {
      return
    }

    let isMounted = true

    const roundMoney = (value: number) => Math.round((value || 0) * 100) / 100
    const monthRange = (monthOffset: number) => {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
      const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0)
      return {
        start: start.toISOString().split("T")[0],
        end: end.toISOString().split("T")[0],
      }
    }

    async function loadAiContext() {
      const currentMonth = monthRange(0)
      const lastMonth = monthRange(-1)

      const [
        transactionsResult,
        invoicesResult,
        billsResult,
        customersResult,
        suppliersResult,
        accountsResult,
        accountLinesResult,
        businessProfileResult,
        serviceJobsResult,
        serviceJobUsageResult,
        currentMonthPaymentsResult,
        currentMonthExpensesResult,
        lastMonthPaymentsResult,
        lastMonthExpensesResult,
      ] = await Promise.all([
        supabase
          .from("journal_entries")
          .select("id, date, description, reference_type, created_at, journal_entry_lines(account_id, debit, credit)")
          .eq("business_id", aiBusinessId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("invoices")
          .select("*")
          .eq("business_id", aiBusinessId)
          .order("created_at", { ascending: false }),
        supabase
          .from("bills")
          .select("*")
          .eq("business_id", aiBusinessId)
          .order("created_at", { ascending: false }),
        supabase
          .from("customers")
          .select("*")
          .eq("business_id", aiBusinessId),
        supabase
          .from("suppliers")
          .select("*")
          .eq("business_id", aiBusinessId),
        supabase
          .from("accounts")
          .select("*")
          .eq("business_id", aiBusinessId),
        supabase
          .from("journal_entry_lines")
          .select("account_id, debit, credit, journal_entries!inner(business_id)")
          .eq("journal_entries.business_id", aiBusinessId),
        supabase
          .from("businesses")
          .select("*")
          .eq("id", aiBusinessId)
          .maybeSingle(),
        supabase
          .from("service_jobs")
          .select("*")
          .eq("business_id", aiBusinessId)
          .order("created_at", { ascending: false }),
        supabase
          .from("service_job_material_usage")
          .select("job_id, total_cost")
          .eq("business_id", aiBusinessId),
        supabase
          .from("payments")
          .select("amount, date")
          .eq("business_id", aiBusinessId)
          .gte("date", currentMonth.start)
          .lte("date", currentMonth.end),
        supabase
          .from("expenses")
          .select("total, date")
          .eq("business_id", aiBusinessId)
          .gte("date", currentMonth.start)
          .lte("date", currentMonth.end),
        supabase
          .from("payments")
          .select("amount, date")
          .eq("business_id", aiBusinessId)
          .gte("date", lastMonth.start)
          .lte("date", lastMonth.end),
        supabase
          .from("expenses")
          .select("total, date")
          .eq("business_id", aiBusinessId)
          .gte("date", lastMonth.start)
          .lte("date", lastMonth.end),
      ])

      if (
        transactionsResult.error ||
        invoicesResult.error ||
        billsResult.error ||
        customersResult.error ||
        suppliersResult.error ||
        accountsResult.error ||
        accountLinesResult.error ||
        businessProfileResult.error ||
        serviceJobsResult.error ||
        serviceJobUsageResult.error ||
        currentMonthPaymentsResult.error ||
        currentMonthExpensesResult.error ||
        lastMonthPaymentsResult.error ||
        lastMonthExpensesResult.error
      ) {
        console.warn("ProtectedLayout: some AI context queries returned errors", {
          transactions: transactionsResult.error,
          invoices: invoicesResult.error,
          bills: billsResult.error,
          customers: customersResult.error,
          suppliers: suppliersResult.error,
          accounts: accountsResult.error,
          accountLines: accountLinesResult.error,
          businessProfile: businessProfileResult.error,
          serviceJobs: serviceJobsResult.error,
          serviceJobUsage: serviceJobUsageResult.error,
          currentMonthPayments: currentMonthPaymentsResult.error,
          currentMonthExpenses: currentMonthExpensesResult.error,
          lastMonthPayments: lastMonthPaymentsResult.error,
          lastMonthExpenses: lastMonthExpensesResult.error,
        })
      }

      const invoices = invoicesResult.data ?? []
      const bills = billsResult.data ?? []
      const customers = customersResult.data ?? []
      const suppliers = suppliersResult.data ?? []
      const accounts = accountsResult.data ?? []
      const accountLines = accountLinesResult.data ?? []
      const transactions = transactionsResult.data ?? []
      const serviceJobs = serviceJobsResult.data ?? []
      const serviceJobUsage = serviceJobUsageResult.data ?? []
      const businessProfile = businessProfileResult.data ?? {}

      const customerNameById = new Map<string, { name: string | null; email: string | null }>()
      for (const customer of customers as any[]) {
        customerNameById.set(String(customer.id), {
          name: customer.name || null,
          email: customer.email || null,
        })
      }

      const supplierNameById = new Map<string, { name: string | null }>()
      for (const supplier of suppliers as any[]) {
        supplierNameById.set(String(supplier.id), {
          name: supplier.name || null,
        })
      }

      const accountLabelById = new Map<string, string>()
      for (const account of accounts as any[]) {
        accountLabelById.set(String(account.id), `${account.code || "N/A"} - ${account.name || "Account"}`)
      }

      const accountBalanceById = new Map<string, number>()
      for (const line of accountLines as any[]) {
        const accountId = String(line.account_id || "")
        if (!accountId) continue
        const debit = Number(line.debit) || 0
        const credit = Number(line.credit) || 0
        accountBalanceById.set(accountId, (accountBalanceById.get(accountId) || 0) + debit - credit)
      }

      const transactionRows = (transactions as any[]).map((entry) => {
        const lines = Array.isArray(entry.journal_entry_lines) ? entry.journal_entry_lines : []
        const totalDebits = lines.reduce((sum: number, line: any) => sum + (Number(line.debit) || 0), 0)
        const totalCredits = lines.reduce((sum: number, line: any) => sum + (Number(line.credit) || 0), 0)
        const primaryLine = [...lines].sort((a: any, b: any) => {
          const aValue = Math.max(Number(a.debit) || 0, Number(a.credit) || 0)
          const bValue = Math.max(Number(b.debit) || 0, Number(b.credit) || 0)
          return bValue - aValue
        })[0]
        const accountLabel = primaryLine?.account_id
          ? accountLabelById.get(String(primaryLine.account_id)) || "Unmapped account"
          : "Unmapped account"

        return {
          id: entry.id,
          date: entry.date || entry.created_at || null,
          description: entry.description ? String(entry.description).slice(0, 200) : "Journal entry",
          amount: roundMoney(Math.max(totalDebits, totalCredits)),
          type: entry.reference_type || "journal_entry",
          account: accountLabel,
        }
      })

      const invoiceAmountByCustomerId = new Map<string, number>()
      for (const invoice of invoices as any[]) {
        const customerId = invoice.customer_id ? String(invoice.customer_id) : ""
        if (!customerId) continue
        const total = Number(invoice.total) || 0
        invoiceAmountByCustomerId.set(customerId, (invoiceAmountByCustomerId.get(customerId) || 0) + total)
      }

      const billAmountBySupplierId = new Map<string, number>()
      for (const bill of bills as any[]) {
        const supplierId = bill.supplier_id ? String(bill.supplier_id) : ""
        if (!supplierId) continue
        const total = Number(bill.total) || Number(bill.amount) || 0
        billAmountBySupplierId.set(supplierId, (billAmountBySupplierId.get(supplierId) || 0) + total)
      }

      const invoiceRows = (invoices as any[]).map((invoice) => {
        const customer = customerNameById.get(String(invoice.customer_id || "")) || { name: null, email: null }
        return {
          id: invoice.id,
          customer: customer.name || "Unknown customer",
          amount: roundMoney(Number(invoice.total) || 0),
          status: invoice.status || "unknown",
          due_date: invoice.due_date || null,
        }
      })

      const billRows = (bills as any[]).map((bill) => {
        const supplier = supplierNameById.get(String(bill.supplier_id || "")) || { name: null }
        return {
          id: bill.id,
          supplier: supplier.name || "Unknown supplier",
          amount: roundMoney(Number(bill.total) || Number(bill.amount) || 0),
          status: bill.status || "unknown",
          due_date: bill.due_date || null,
        }
      })

      const customerRows = (customers as any[]).map((customer) => ({
        id: customer.id,
        name: customer.name || "Unknown customer",
        email: customer.email || null,
        total_billed: roundMoney(invoiceAmountByCustomerId.get(String(customer.id)) || 0),
      }))

      const supplierRows = (suppliers as any[]).map((supplier) => ({
        id: supplier.id,
        name: supplier.name || "Unknown supplier",
        total_billed: roundMoney(billAmountBySupplierId.get(String(supplier.id)) || 0),
      }))

      const accountsRows = (accounts as any[]).map((account) => ({
        id: account.id,
        code: account.code || null,
        name: account.name || "Unnamed account",
        type: account.type || null,
        sub_type: account.sub_type || null,
        balance: roundMoney(accountBalanceById.get(String(account.id)) || 0),
      }))

      const usageTotalByJobId = new Map<string, number>()
      for (const usage of serviceJobUsage as any[]) {
        const jobId = String(usage.job_id || "")
        if (!jobId) continue
        usageTotalByJobId.set(jobId, (usageTotalByJobId.get(jobId) || 0) + (Number(usage.total_cost) || 0))
      }

      const serviceJobRows = (serviceJobs as any[]).map((job) => {
        const inferredAmount =
          Number(job.amount) ||
          Number(job.total_amount) ||
          Number(job.quoted_amount) ||
          Number(job.total) ||
          usageTotalByJobId.get(String(job.id)) ||
          0

        return {
          id: job.id,
          status: job.status || "unknown",
          assigned_staff: job.assigned_staff_id || job.staff_id || job.technician_id || job.assigned_to || null,
          amount: roundMoney(inferredAmount),
        }
      })

      const currentIncome = roundMoney(
        (currentMonthPaymentsResult.data ?? []).reduce((sum: number, row: any) => sum + (Number(row.amount) || 0), 0)
      )
      const currentExpenses = roundMoney(
        (currentMonthExpensesResult.data ?? []).reduce((sum: number, row: any) => sum + (Number(row.total) || 0), 0)
      )
      const lastIncome = roundMoney(
        (lastMonthPaymentsResult.data ?? []).reduce((sum: number, row: any) => sum + (Number(row.amount) || 0), 0)
      )
      const lastExpenses = roundMoney(
        (lastMonthExpensesResult.data ?? []).reduce((sum: number, row: any) => sum + (Number(row.total) || 0), 0)
      )

      const unpaidInvoiceStatuses = new Set(["sent", "partial", "overdue", "unpaid"])
      const unpaidBillStatuses = new Set(["pending", "partial", "overdue", "unpaid", "approved"])

      const unpaidInvoicesTotal = roundMoney(
        (invoices as any[]).reduce((sum: number, invoice: any) => {
          const status = String(invoice.status || "").toLowerCase()
          const openAmount = Number(invoice.balance_due) || Number(invoice.amount_due) || Number(invoice.total) || 0
          if (!unpaidInvoiceStatuses.has(status)) return sum
          return sum + openAmount
        }, 0)
      )

      const unpaidBillsTotal = roundMoney(
        (bills as any[]).reduce((sum: number, bill: any) => {
          const status = String(bill.status || "").toLowerCase()
          const openAmount = Number(bill.balance_due) || Number(bill.amount_due) || Number(bill.total) || Number(bill.amount) || 0
          if (!unpaidBillStatuses.has(status)) return sum
          return sum + openAmount
        }, 0)
      )

      const whtSettings = Object.fromEntries(
        Object.entries(businessProfile as Record<string, unknown>).filter(([key]) => {
          const lowered = key.toLowerCase()
          return lowered.includes("wht") || lowered.includes("withholding")
        })
      )

      const builtContext = {
        generated_at: new Date().toISOString(),
        business_id: aiBusinessId,
        page_scope: "global",
        transactions: {
          label: "Last 50 transactions",
          count: transactionRows.length,
          total_amount: roundMoney(transactionRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
          rows: transactionRows,
        },
        invoices: {
          label: "All invoices",
          count: invoiceRows.length,
          total_amount: roundMoney(invoiceRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
          rows: invoiceRows,
        },
        bills: {
          label: "All bills",
          count: billRows.length,
          total_amount: roundMoney(billRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
          rows: billRows,
        },
        customers: {
          label: "All customers",
          count: customerRows.length,
          total_billed: roundMoney(customerRows.reduce((sum, row) => sum + (Number(row.total_billed) || 0), 0)),
          rows: customerRows,
        },
        suppliers: {
          label: "All suppliers",
          count: supplierRows.length,
          total_billed: roundMoney(supplierRows.reduce((sum, row) => sum + (Number(row.total_billed) || 0), 0)),
          rows: supplierRows,
        },
        accounts: {
          label: "All chart of accounts with current balances",
          count: accountsRows.length,
          net_balance: roundMoney(accountsRows.reduce((sum, row) => sum + (Number(row.balance) || 0), 0)),
          rows: accountsRows,
        },
        tax_profile: {
          label: "Business tax profile",
          vat_scheme: (businessProfile as any).vat_scheme || null,
          cit_rate: (businessProfile as any).cit_rate_code || null,
          wht_settings: whtSettings,
        },
        service_jobs: {
          label: "All service jobs",
          count: serviceJobRows.length,
          total_amount: roundMoney(serviceJobRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
          rows: serviceJobRows,
        },
        monthly_summary: {
          label: "Current and last month financial summary",
          current_month: {
            period_start: currentMonth.start,
            period_end: currentMonth.end,
            total_income: currentIncome,
            total_expenses: currentExpenses,
            net_profit: roundMoney(currentIncome - currentExpenses),
          },
          last_month: {
            period_start: lastMonth.start,
            period_end: lastMonth.end,
            total_income: lastIncome,
            total_expenses: lastExpenses,
            net_profit: roundMoney(lastIncome - lastExpenses),
          },
        },
        unpaid_invoices_total: {
          label: "Total outstanding receivables",
          amount: unpaidInvoicesTotal,
        },
        unpaid_bills_total: {
          label: "Total outstanding payables",
          amount: unpaidBillsTotal,
        },
      }

      if (isMounted) {
        setAiContext(builtContext)
      }
    }

    loadAiContext().catch((error) => {
      console.error("ProtectedLayout: Failed to load global AI context", error)
      if (isMounted) {
        setAiContext({
          generated_at: new Date().toISOString(),
          business_id: aiBusinessId,
          page_scope: "global",
          warning: "Some context data could not be loaded.",
        })
      }
    })

    return () => {
      isMounted = false
    }
  }, [aiBusinessId, isNestedProtectedLayout, aiContextRefreshKey])

  if (isNestedProtectedLayout) {
    return <>{children}</>
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <p className="p-6">Loading...</p>
      </div>
    )
  }

  const invoiceIdFromPath =
    pathname?.match(/\/service\/invoices\/([0-9a-f-]{36})\/(?:view|edit)/i)?.[1] ?? null

  return (
    <ProtectedLayoutContext.Provider value={true}>
      <WorkspaceBusinessProvider
        value={{ business: workspaceBusiness, sessionUser: workspaceSessionUser }}
      >
      <Suspense fallback={null}>
        <ServiceSubscriptionProvider>
          <RetailPosIdleSessionWatcher pathname={pathname} />
          <AppIdleTimeoutWatcher pathname={pathname} />
          <div
            className="min-h-screen bg-gray-50 dark:bg-gray-900"
            data-export-mode={isExportMode ? "true" : undefined}
          >
            {/* Sidebar - hidden in print/export/preview (export-hide) */}
            {!hideRetailOwnerChrome && !isAccountingRoute && (
              <div className="export-hide print-hide">
                <Sidebar />
              </div>
            )}

            {/* Main Layout */}
            <div className={hideRetailOwnerChrome || isAccountingRoute ? "" : "lg:pl-64"}>
          {/* Top navigation for non-accounting workspaces. */}
          {!hideRetailOwnerChrome && !pathname?.startsWith('/service') && !isAccountingRoute && (
            <nav className="export-hide print-hide bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm sticky top-0 z-30">
              <div className="px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-16">
                  <div className="flex items-center gap-4">
                    {/* Mobile menu button - will be handled by Sidebar component */}
                  </div>
                  <div className="flex items-center gap-4">
                    {!isPOSRoute && <StoreSwitcher />}
                  </div>
                </div>
              </div>
            </nav>
          )}

          {/* Main content — full height when owner top nav is hidden (PIN, POS shell, cashier) */}
          <main
            className={
              pathname?.startsWith("/service")
                ? "min-h-screen"
                : hideRetailOwnerChrome
                  ? "min-h-screen"
                  : "min-h-[calc(100vh-4rem)]"
            }
          >
            <PlatformAnnouncementsHost
              businessIndustry={
                workspaceBusiness != null && typeof workspaceBusiness.industry === "string"
                  ? workspaceBusiness.industry
                  : undefined
              }
            >
              {children}
            </PlatformAnnouncementsHost>
            {!hideFloatingAssistant && (
              <div className="fixed bottom-3 right-3 z-40 w-auto max-w-[calc(100vw-1.5rem)]">
                <AiAssistant
                  onPanelOpen={() => setAiContextRefreshKey((k) => k + 1)}
                  context={{
                    ...(aiContext ?? { page_scope: "global", warning: "AI context is still loading." }),
                    current_path: pathname || "/",
                    ...(invoiceIdFromPath ? { page_invoice_id: invoiceIdFromPath } : {}),
                  }}
                />
              </div>
            )}
          </main>
            </div>
          </div>
        </ServiceSubscriptionProvider>
      </Suspense>
      </WorkspaceBusinessProvider>
    </ProtectedLayoutContext.Provider>
  )
}
















