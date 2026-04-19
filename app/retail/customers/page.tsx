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

type Customer = {
  id: string
  name: string
  phone: string | null
  email: string | null
  status: "active" | "blocked"
  created_at: string
}

function statusTone(status: string): "success" | "danger" {
  return status === "active" ? "success" : "danger"
}

export default function RetailCustomersPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [customers, setCustomers] = useState<Customer[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const loadCustomers = async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Sign in to manage customers.")
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

      const response = await fetch(`/api/customers?${params.toString()}`)
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || "Could not load customers")
      setCustomers(data.customers || [])
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not load customers"
      console.error("Error loading customers:", err)
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- search runs on button / Enter only
  }, [statusFilter])

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-5xl">
        <RetailBackofficePageHeader
          eyebrow="Sales"
          title="Customers"
          description="People who buy at your store. Use search and status filters, then open a profile to view or edit."
          actions={
            <RetailBackofficeButton variant="primary" type="button" onClick={() => router.push("/retail/customers/new")}>
              Add customer
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
                placeholder="Name, phone, or email"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void loadCustomers()}
                className={retailFieldClass}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <RetailBackofficeButton variant="secondary" type="button" onClick={() => void loadCustomers()}>
                Search
              </RetailBackofficeButton>
            </div>
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
        ) : customers.length === 0 ? (
          <RetailBackofficeEmpty
            title="No customers match"
            description="Try another search, clear filters, or add someone you sell to often."
            action={
              <RetailBackofficeButton variant="primary" type="button" onClick={() => router.push("/retail/customers/new")}>
                Add customer
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
                      Name
                    </th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Contact
                    </th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Status
                    </th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Added
                    </th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-6">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {customers.map((customer) => (
                    <tr key={customer.id} className="transition hover:bg-slate-50/80">
                      <td className="px-4 py-3.5 font-medium text-slate-900 sm:px-6">{customer.name}</td>
                      <td className="px-4 py-3.5 text-slate-600 sm:px-6">
                        <div className="whitespace-nowrap">{customer.phone || "—"}</div>
                        <div className="text-xs text-slate-500">{customer.email || "—"}</div>
                      </td>
                      <td className="px-4 py-3.5 sm:px-6">
                        <RetailBackofficeBadge tone={statusTone(customer.status)}>
                          {customer.status === "active" ? "Active" : "Blocked"}
                        </RetailBackofficeBadge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-slate-600 sm:px-6">
                        {new Date(customer.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3.5 text-right sm:px-6">
                        <Link
                          href={`/retail/customers/${customer.id}`}
                          className="mr-3 text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
                        >
                          View
                        </Link>
                        <Link
                          href={`/retail/customers/${customer.id}/edit`}
                          className="text-sm font-medium text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
                        >
                          Edit
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
