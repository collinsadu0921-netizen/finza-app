"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { retailPaths } from "@/lib/retail/routes"
import { getUserRole } from "@/lib/userRoles"
import {
  RetailBackofficeAlert,
  RetailBackofficeBackLink,
  RetailBackofficeBadge,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeCardTitle,
  RetailBackofficeEmpty,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  RetailMenuSelect,
  type MenuSelectOption,
} from "@/components/retail/RetailBackofficeUi"

type StockMovement = {
  id: string
  product_id: string
  product_name: string
  quantity_change: number
  type: "sale" | "refund" | "adjustment" | "initial_import"
  created_at: string
  note: string | null
  related_sale_id: string | null
  user?: {
    email: string
    full_name: string
  }
}

const MOVEMENT_TYPE_FILTER_OPTIONS: MenuSelectOption[] = [
  { value: "all", label: "All Types" },
  { value: "sale", label: "Sale" },
  { value: "refund", label: "Refunds" },
  { value: "adjustment", label: "Adjustment" },
  { value: "initial_import", label: "Import" },
]

const MOVEMENT_DATE_FILTER_OPTIONS: MenuSelectOption[] = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "custom", label: "Custom Range" },
]

export default function RetailInventoryHistoryPage() {
  const router = useRouter()
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [hasAccess, setHasAccess] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const itemsPerPage = 50

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [productFilter, setProductFilter] = useState<string>("all")
  const [dateFilter, setDateFilter] = useState<string>("all")
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([])
  const [customStartDate, setCustomStartDate] = useState("")
  const [customEndDate, setCustomEndDate] = useState("")

  const productFilterMenuOptions = useMemo(() => {
    const head: MenuSelectOption[] = [{ value: "all", label: "All Products" }]
    return head.concat(products.map((p) => ({ value: p.id, label: p.name })))
  }, [products])

  useEffect(() => {
    loadData()
  }, [currentPage, typeFilter, productFilter, dateFilter, customStartDate, customEndDate])

  const loadData = async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Not authenticated")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      setBusinessId(business.id)

      // Check permissions - only owner, admin, manager can view history
      const role = await getUserRole(supabase, user.id, business.id)
      if (role !== "owner" && role !== "admin" && role !== "manager") {
        setError("Access denied. Only owners, admins, and managers can view inventory history.")
        setHasAccess(false)
        setLoading(false)
        return
      }

      setHasAccess(true)

      // Load products for filter
      const { data: productsData } = await supabase
        .from("products")
        .select("id, name")
        .eq("business_id", business.id)
        .order("name", { ascending: true })

      if (productsData) {
        setProducts(productsData)
      }

      // Build query with filters
      const from = (currentPage - 1) * itemsPerPage
      const to = from + itemsPerPage - 1

      let query = supabase
        .from("stock_movements")
        .select(
          `
          id,
          product_id,
          quantity_change,
          type,
          created_at,
          note,
          related_sale_id,
          user_id,
          products:product_id (
            name
          )
        `,
          { count: "exact" }
        )
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })

      // Type filter
      if (typeFilter !== "all") {
        query = query.eq("type", typeFilter)
      }

      // Product filter
      if (productFilter !== "all") {
        query = query.eq("product_id", productFilter)
      }

      // Date filter
      if (dateFilter === "today") {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        query = query.gte("created_at", today.toISOString())
      } else if (dateFilter === "yesterday") {
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        yesterday.setHours(0, 0, 0, 0)
        const endOfYesterday = new Date(yesterday)
        endOfYesterday.setHours(23, 59, 59, 999)
        query = query.gte("created_at", yesterday.toISOString()).lte("created_at", endOfYesterday.toISOString())
      } else if (dateFilter === "this_week") {
        const weekStart = new Date()
        weekStart.setDate(weekStart.getDate() - weekStart.getDay())
        weekStart.setHours(0, 0, 0, 0)
        query = query.gte("created_at", weekStart.toISOString())
      } else if (dateFilter === "this_month") {
        const monthStart = new Date()
        monthStart.setDate(1)
        monthStart.setHours(0, 0, 0, 0)
        query = query.gte("created_at", monthStart.toISOString())
      } else if (dateFilter === "custom" && customStartDate && customEndDate) {
        const start = new Date(customStartDate)
        start.setHours(0, 0, 0, 0)
        const end = new Date(customEndDate)
        end.setHours(23, 59, 59, 999)
        query = query.gte("created_at", start.toISOString()).lte("created_at", end.toISOString())
      }

      const { data: movementsData, error: movementsError, count } = await query.range(from, to)

      if (movementsError) {
        setError(`Error loading stock movements: ${movementsError.message}`)
        setLoading(false)
        return
      }

      // Fetch user data separately for each unique user_id
      const userIds = Array.from(new Set((movementsData || []).map((m: any) => m.user_id).filter(Boolean)))
      const userMap: Record<string, { email: string; full_name: string }> = {}

      if (userIds.length > 0) {
        // Try to fetch from users table first
        const { data: usersData } = await supabase
          .from("users")
          .select("id, email, full_name")
          .in("id", userIds)

        if (usersData) {
          usersData.forEach((u) => {
            userMap[u.id] = {
              email: u.email || "",
              full_name: u.full_name || "",
            }
          })
        }

        // For any missing users, try to get from auth (admin only, may not work)
        // If users table doesn't have all users, we'll just show the user_id
      }

      setMovements(
        (movementsData || []).map((m: any) => ({
          id: m.id,
          product_id: m.product_id,
          product_name: m.products?.name || "Unknown Product",
          quantity_change: m.quantity_change,
          type: m.type,
          created_at: m.created_at,
          note: m.note,
          related_sale_id: m.related_sale_id,
          user: userMap[m.user_id]
            ? {
                email: userMap[m.user_id].email,
                full_name: userMap[m.user_id].full_name,
              }
            : undefined,
        }))
      )

      if (count !== null) {
        setTotalCount(count)
        setTotalPages(Math.ceil(count / itemsPerPage))
      }

      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load inventory history")
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    })
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "sale":
        return "Sale"
      case "refund":
        return "Refund"
      case "adjustment":
        return "Adjustment"
      case "initial_import":
        return "Import"
      default:
        return type
    }
  }

  const getTypeBadgeTone = (type: string): "neutral" | "success" | "info" => {
    switch (type) {
      case "sale":
        return "neutral"
      case "refund":
        return "success"
      case "adjustment":
        return "info"
      case "initial_import":
        return "neutral"
      default:
        return "neutral"
    }
  }

  if (!hasAccess && !loading) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain>
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error || "Access denied"}
          </RetailBackofficeAlert>
          <RetailBackofficeButton variant="secondary" onClick={() => router.push(retailPaths.inventory)}>
            Back to inventory
          </RetailBackofficeButton>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain>
        <RetailBackofficeBackLink onClick={() => router.push(retailPaths.inventory)}>Back to inventory</RetailBackofficeBackLink>

        <RetailBackofficePageHeader
          eyebrow="Product & inventory"
          title="Movement history"
          description="Every stock change with filters for type, product, and date range. Useful for audits and variance checks."
        />

        <RetailBackofficeCard className="mb-6" padding="p-5 sm:p-6">
          <RetailBackofficeCardTitle className="mb-4">Filters</RetailBackofficeCardTitle>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Type</label>
              <RetailMenuSelect
                value={typeFilter}
                onValueChange={(v) => {
                  setTypeFilter(v)
                  setCurrentPage(1)
                }}
                options={MOVEMENT_TYPE_FILTER_OPTIONS}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Product</label>
              <RetailMenuSelect
                value={productFilter}
                onValueChange={(v) => {
                  setProductFilter(v)
                  setCurrentPage(1)
                }}
                options={productFilterMenuOptions}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Date range</label>
              <RetailMenuSelect
                value={dateFilter}
                onValueChange={(v) => {
                  setDateFilter(v)
                  setCurrentPage(1)
                }}
                options={MOVEMENT_DATE_FILTER_OPTIONS}
              />
            </div>

            {dateFilter === "custom" && (
              <div className="md:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Custom range</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => {
                      setCustomStartDate(e.target.value)
                      setCurrentPage(1)
                    }}
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/[0.08]"
                  />
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => {
                      setCustomEndDate(e.target.value)
                      setCurrentPage(1)
                    }}
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/[0.08]"
                  />
                </div>
              </div>
            )}
          </div>
        </RetailBackofficeCard>

        {error ? (
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        {loading ? (
          <RetailBackofficeCard className="text-center text-sm text-slate-600">Loading movement history…</RetailBackofficeCard>
        ) : movements.length === 0 ? (
          <RetailBackofficeEmpty
            title="No movements match your filters"
            description="Try widening the date range or clearing product and type filters."
          />
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-600">
              Showing {((currentPage - 1) * itemsPerPage) + 1}–{Math.min(currentPage * itemsPerPage, totalCount)} of{" "}
              {totalCount} movements
            </p>

            <RetailBackofficeCard padding="p-0" className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead className="border-b border-slate-100 bg-slate-50/80">
                    <tr>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Date & time
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Product
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Type
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Qty change
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        User
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Note
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Related sale
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {movements.map((movement) => (
                      <tr key={movement.id} className="transition-colors hover:bg-slate-50/60">
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-800">{formatDate(movement.created_at)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          <a
                            href={retailPaths.inventoryStockHistory(movement.product_id)}
                            className="font-medium text-slate-900 underline decoration-slate-300 decoration-1 underline-offset-2 hover:decoration-slate-500"
                          >
                            {movement.product_name}
                          </a>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          <RetailBackofficeBadge tone={getTypeBadgeTone(movement.type)}>{getTypeLabel(movement.type)}</RetailBackofficeBadge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums">
                          <span
                            className={
                              movement.quantity_change > 0
                                ? "font-semibold text-emerald-800"
                                : movement.quantity_change < 0
                                  ? "font-semibold text-rose-800"
                                  : "font-medium text-slate-600"
                            }
                          >
                            {movement.quantity_change > 0 ? "+" : ""}
                            {movement.quantity_change}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                          {movement.user?.full_name || movement.user?.email || "—"}
                        </td>
                        <td className="max-w-xs truncate px-4 py-3 text-sm text-slate-600" title={movement.note || undefined}>
                          {movement.note || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                          {movement.related_sale_id ? (
                            <a
                              href={retailPaths.salesHistoryDetail(movement.related_sale_id)}
                              className="font-medium text-slate-900 underline decoration-slate-300 decoration-1 underline-offset-2 hover:decoration-slate-500"
                            >
                              View sale
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </RetailBackofficeCard>

            {totalPages > 1 && (
              <div className="mt-6 flex flex-col gap-3 border-t border-slate-200/80 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-600">
                  Page {currentPage} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <RetailBackofficeButton
                    variant="secondary"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  >
                    Previous
                  </RetailBackofficeButton>
                  <RetailBackofficeButton
                    variant="secondary"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  >
                    Next
                  </RetailBackofficeButton>
                </div>
              </div>
            )}
          </>
        )}
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}

