"use client"

import { useEffect, useMemo, useState } from "react"
import {
  applyBillSupplierSelection,
  loadBillSuppliers,
  supplierSelectLabel,
  type BillSupplierOption,
} from "@/lib/bills/loadBillSuppliers"
import { selectCreatedBillSupplier } from "@/lib/bills/selectCreatedBillSupplier"
import { toBillSupplierHydrate } from "@/lib/suppliers/createSupplier"
import SupplierEditorModal from "@/components/suppliers/SupplierEditorModal"
import { supplierMatchesDirectorySearch } from "@/lib/suppliers/directorySearch"

export type BillSupplierHydrate = { name: string; phone: string; email: string }

type Props = {
  businessId: string | null
  selectedSupplierId: string
  onChange: (selectedId: string, hydrate: BillSupplierHydrate | null) => void
  selectClassName?: string
  variant?: "create" | "edit"
}

export default function BillSupplierSelector({
  businessId,
  selectedSupplierId,
  onChange,
  selectClassName,
  variant = "create",
}: Props) {
  const [suppliers, setSuppliers] = useState<BillSupplierOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [addOpen, setAddOpen] = useState(false)
  const [query, setQuery] = useState("")

  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    setLoading(true)
    setError("")
    loadBillSuppliers(businessId)
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          setSuppliers(result.suppliers)
          setError("")
        } else {
          setSuppliers([])
          setError(result.error)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [businessId])

  const visible = useMemo(() => {
    if (!query.trim()) return suppliers
    return suppliers.filter((supplier) => supplierMatchesDirectorySearch(supplier, query))
  }, [suppliers, query])

  const handleSelect = (supplierId: string) => {
    const result = applyBillSupplierSelection(supplierId, suppliers)
    onChange(result.selectedId, result.hydrate)
  }

  const defaultSelectClass =
    variant === "edit"
      ? "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
      : "border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-100 focus:border-slate-400 w-full"

  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 dark:text-gray-300 mb-2">
        Choose Existing Supplier
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          value={selectedSupplierId}
          onChange={(e) => handleSelect(e.target.value)}
          className={selectClassName || defaultSelectClass}
        >
          <option value="">Type manually (or select supplier)</option>
          {visible.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplierSelectLabel(supplier)}
            </option>
          ))}
          {selectedSupplierId && !visible.some((s) => s.id === selectedSupplierId)
            ? suppliers
                .filter((s) => s.id === selectedSupplierId)
                .map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplierSelectLabel(supplier)}
                  </option>
                ))
            : null}
        </select>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          disabled={!businessId}
          className="whitespace-nowrap px-3 py-2.5 text-sm font-medium rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
        >
          + Add new supplier
        </button>
      </div>
      {suppliers.length > 8 ? (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search suppliers…"
          className="mt-2 w-full border border-slate-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white"
        />
      ) : null}
      {loading ? <p className="mt-1 text-xs text-slate-500">Loading suppliers…</p> : null}
      {error ? (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          {error}. You can still type a supplier name.
        </p>
      ) : null}
      {businessId ? (
        <SupplierEditorModal
          isOpen={addOpen}
          onClose={() => setAddOpen(false)}
          businessId={businessId}
          existingSuppliers={suppliers}
          onCreated={(created) => {
            const option: BillSupplierOption = {
              id: created.id,
              name: created.name,
              phone: created.phone,
              email: created.email,
              status: created.status,
            }
            const next = selectCreatedBillSupplier(option, suppliers)
            setSuppliers(next.suppliers)
            onChange(next.selectedId, next.hydrate || toBillSupplierHydrate(created))
          }}
        />
      ) : null}
    </div>
  )
}
