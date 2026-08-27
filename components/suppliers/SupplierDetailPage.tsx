"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useServicePageBusiness } from "@/lib/hooks/useServicePageBusiness"
import { formatMoney } from "@/lib/money"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import SupplierFormFields from "@/components/suppliers/SupplierFormFields"
import {
  parseSupplierRecord,
  updateSupplierRecord,
  type SupplierFormValues,
  type SupplierRecord,
} from "@/lib/suppliers/createSupplier"

type SupplierBill = {
  id: string
  bill_number: string
  issue_date: string
  due_date: string | null
  total: number
  status: string
  supplier_id: string
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  open: "Open",
  partially_paid: "Partial",
  paid: "Paid",
  overdue: "Overdue",
}

export default function SupplierDetailPage({ supplierId }: { supplierId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { businessId, ready: workspaceReady, error: workspaceError } = useServicePageBusiness()
  const { currencyCode } = useBusinessCurrency()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [billsError, setBillsError] = useState("")
  const [supplier, setSupplier] = useState<SupplierRecord | null>(null)
  const [bills, setBills] = useState<SupplierBill[]>([])
  const [editing, setEditing] = useState(searchParams.get("edit") === "1")
  const [values, setValues] = useState<SupplierFormValues>({ name: "" })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!workspaceReady) return
    if (workspaceError) {
      setError(workspaceError)
      setLoading(false)
      return
    }
    if (!businessId) {
      setError("Business not found")
      setLoading(false)
      return
    }
    void loadDetail(businessId)
  }, [workspaceReady, workspaceError, businessId, supplierId])

  const loadDetail = async (bid: string) => {
    try {
      setLoading(true)
      setError("")
      setBillsError("")
      const params = new URLSearchParams({ business_id: bid, include: "bills" })
      const response = await fetch(`/api/suppliers/${encodeURIComponent(supplierId)}?${params.toString()}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || "Supplier not found")
      }
      const parsed = parseSupplierRecord(data.supplier)
      if (!parsed) throw new Error("Supplier not found")
      setSupplier(parsed)
      setValues({
        name: parsed.name,
        phone: parsed.phone || "",
        email: parsed.email || "",
        location_line: parsed.location_line || "",
        tax_id: parsed.tax_id || "",
      })
      setBills(Array.isArray(data.bills) ? data.bills : [])
      if (data.bills_error) setBillsError(String(data.bills_error))
    } catch (err: unknown) {
      setSupplier(null)
      setError(err instanceof Error ? err.message : "Supplier not found")
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    if (!businessId || !supplier) return
    if (!values.name.trim()) {
      setError("Supplier name is required")
      return
    }
    setSaving(true)
    setError("")
    const result = await updateSupplierRecord(supplier.id, businessId, values)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSupplier(result.supplier)
    setEditing(false)
  }

  if (!workspaceReady || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-sm text-gray-500">Loading supplier…</p>
      </div>
    )
  }

  if (error && !supplier) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <p className="text-red-600 text-sm">{error}</p>
        <Link href="/service/suppliers" className="text-blue-600 text-sm mt-3 inline-block">
          Back to suppliers
        </Link>
      </div>
    )
  }

  if (!supplier) return null

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <button
        type="button"
        onClick={() => router.push("/service/suppliers")}
        className="text-sm text-gray-500 hover:text-gray-800"
      >
        ← Suppliers
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{supplier.name}</h1>
          <p className="text-sm text-gray-500 mt-1">Supplier details and linked bills</p>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            Edit supplier
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      ) : null}

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6">
        {editing ? (
          <div className="space-y-4">
            <SupplierFormFields values={values} onChange={setValues} disabled={saving} idPrefix="edit-supplier" />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setValues({
                    name: supplier.name,
                    phone: supplier.phone || "",
                    email: supplier.email || "",
                    location_line: supplier.location_line || "",
                    tax_id: supplier.tax_id || "",
                  })
                }}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Editing this supplier does not change names or contact details already saved on historical bills.
            </p>
          </div>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">Phone</dt>
              <dd className="font-medium text-gray-900 dark:text-white">{supplier.phone || "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Email</dt>
              <dd className="font-medium text-gray-900 dark:text-white">{supplier.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Address</dt>
              <dd className="font-medium text-gray-900 dark:text-white">{supplier.location_line || "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Tax / TIN / VAT ID</dt>
              <dd className="font-medium text-gray-900 dark:text-white">{supplier.tax_id || "—"}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Supplier bills</h2>
          <p className="text-xs text-gray-500 mt-1">Only bills linked to this supplier record.</p>
        </div>
        {billsError ? (
          <p className="px-6 py-4 text-sm text-amber-700">{billsError}</p>
        ) : bills.length === 0 ? (
          <p className="px-6 py-8 text-sm text-gray-500">No linked supplier bills yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Bill</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Bill date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Due date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Total</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {bills.map((bill) => (
                  <tr
                    key={bill.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/40 cursor-pointer"
                    onClick={() => router.push(`/bills/${bill.id}/view`)}
                  >
                    <td className="px-6 py-3 font-medium text-blue-600">{bill.bill_number}</td>
                    <td className="px-6 py-3">{bill.issue_date || "—"}</td>
                    <td className="px-6 py-3">{bill.due_date || "—"}</td>
                    <td className="px-6 py-3">{formatMoney(Number(bill.total) || 0, currencyCode)}</td>
                    <td className="px-6 py-3">{STATUS_LABEL[bill.status] || bill.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
