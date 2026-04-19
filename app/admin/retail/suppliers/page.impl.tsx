"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import Link from "next/link"
import {
  RetailBackofficeAlert,
  RetailBackofficeBadge,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeEmpty,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  RetailBackofficeSkeleton,
  retailFieldClass,
  retailLabelClass,
} from "@/components/retail/RetailBackofficeUi"
import { supplierPaymentPreferenceLabel, supplierPaymentTermsLabel } from "@/lib/retail/supplierRetailFields"

type Supplier = {
  id: string
  name: string
  phone: string | null
  email: string | null
  status: "active" | "blocked"
  created_at: string
  contact_person?: string | null
  payment_preference?: string | null
  payment_terms_type?: string | null
  payment_terms_custom?: string | null
  location_line?: string | null
}

function statusTone(status: string): "success" | "danger" {
  return status === "active" ? "success" : "danger"
}

export default function SuppliersPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const loadSuppliers = async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Sign in to manage suppliers.")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("No store found for your account.")
        setLoading(false)
        return
      }

      const params = new URLSearchParams()
      if (statusFilter !== "all") params.append("status", statusFilter)
      if (searchQuery.trim()) params.append("search", searchQuery.trim())

      const response = await fetch(`/api/suppliers?${params.toString()}`)
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || "Failed to load suppliers")

      setSuppliers(data.suppliers || [])
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load suppliers"
      console.error("Error loading suppliers:", err)
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSuppliers()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- search on button / Enter like customers list
  }, [statusFilter])

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-5xl">
        <RetailBackofficePageHeader
          eyebrow="Procurement"
          title="Suppliers"
          description="Who you buy stock from — contacts, how you pay, and quick links to purchase orders. Keep records light and practical."
          actions={
            <RetailBackofficeButton variant="primary" type="button" onClick={() => router.push("/retail/admin/suppliers/new")}>
              New supplier
            </RetailBackofficeButton>
          }
        />

        {error ? (
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        <RetailBackofficeCard className="mb-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <label className={retailLabelClass}>Search</label>
              <input
                type="search"
                placeholder="Name, phone, contact, location, notes…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void loadSuppliers()}
                className={retailFieldClass}
                autoComplete="off"
              />
            </div>
            <RetailBackofficeButton variant="secondary" type="button" onClick={() => void loadSuppliers()}>
              Search
            </RetailBackofficeButton>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {(["all", "active", "blocked"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  statusFilter === key
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                {key === "all" ? "All" : key === "active" ? "Active" : "Blocked"}
              </button>
            ))}
          </div>
        </RetailBackofficeCard>

        {loading ? (
          <RetailBackofficeSkeleton rows={5} />
        ) : suppliers.length === 0 ? (
          <RetailBackofficeEmpty
            title="No suppliers match"
            description="Try another search, clear filters, or add a vendor you order from often."
            action={
              <RetailBackofficeButton variant="primary" type="button" onClick={() => router.push("/retail/admin/suppliers/new")}>
                New supplier
              </RetailBackofficeButton>
            }
          />
        ) : (
          <RetailBackofficeCard padding="p-0 sm:p-0" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 backdrop-blur-sm">
                  <tr>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Business
                    </th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Contact
                    </th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Pay / terms
                    </th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {suppliers.map((supplier) => (
                    <tr key={supplier.id} className="transition hover:bg-slate-50/80">
                      <td className="px-4 py-3.5 font-medium text-slate-900 sm:px-6">
                        <div>{supplier.name}</div>
                        {supplier.location_line ? (
                          <div className="mt-0.5 max-w-xs truncate text-xs text-slate-500">{supplier.location_line}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5 text-slate-600 sm:px-6">
                        {supplier.contact_person ? (
                          <div className="font-medium text-slate-800">{supplier.contact_person}</div>
                        ) : null}
                        <div className="whitespace-nowrap">{supplier.phone || "—"}</div>
                        <div className="text-xs text-slate-500">{supplier.email || "—"}</div>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-600 sm:px-6">
                        <div>{supplierPaymentPreferenceLabel(supplier.payment_preference ?? undefined)}</div>
                        <div className="text-slate-500">
                          {supplierPaymentTermsLabel(
                            supplier.payment_terms_type ?? undefined,
                            supplier.payment_terms_custom
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 sm:px-6">
                        <RetailBackofficeBadge tone={statusTone(supplier.status)}>
                          {supplier.status === "active" ? "Active" : "Blocked"}
                        </RetailBackofficeBadge>
                      </td>
                      <td className="px-4 py-3.5 text-right sm:px-6">
                        <Link
                          href={`/retail/admin/suppliers/${supplier.id}`}
                          className="mr-3 text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
                        >
                          Open
                        </Link>
                        <Link
                          href={`/retail/admin/purchase-orders/new?supplier_id=${encodeURIComponent(supplier.id)}`}
                          className="text-sm font-medium text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
                        >
                          New PO
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </RetailBackofficeCard>
        )}
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
