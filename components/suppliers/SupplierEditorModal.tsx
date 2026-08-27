"use client"

import { useState } from "react"
import Modal from "@/components/ui/Modal"
import SupplierFormFields from "@/components/suppliers/SupplierFormFields"
import {
  createSupplierRecord,
  type SupplierFormValues,
  type SupplierRecord,
} from "@/lib/suppliers/createSupplier"
import {
  duplicateNameWarning,
  findExactNameDuplicates,
  type NamedSupplier,
} from "@/lib/suppliers/duplicateName"

type Props = {
  isOpen: boolean
  onClose: () => void
  businessId: string
  existingSuppliers: NamedSupplier[]
  onCreated: (supplier: SupplierRecord) => void
  title?: string
}

const EMPTY: SupplierFormValues = {
  name: "",
  phone: "",
  email: "",
  location_line: "",
  tax_id: "",
}

export default function SupplierEditorModal({
  isOpen,
  onClose,
  businessId,
  existingSuppliers,
  onCreated,
  title = "Add Supplier",
}: Props) {
  const [values, setValues] = useState<SupplierFormValues>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [duplicate, setDuplicate] = useState<NamedSupplier | null>(null)

  const resetAndClose = () => {
    setValues(EMPTY)
    setError("")
    setDuplicate(null)
    setSaving(false)
    onClose()
  }

  const submit = async (allowDuplicate: boolean) => {
    setError("")
    if (!values.name.trim()) {
      setError("Supplier name is required")
      return
    }
    const matches = findExactNameDuplicates(values.name, existingSuppliers)
    if (matches.length > 0 && !allowDuplicate) {
      setDuplicate(matches[0])
      return
    }

    setSaving(true)
    const result = await createSupplierRecord(businessId, values)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onCreated(result.supplier)
    resetAndClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetAndClose}
      title={title}
      size="md"
      closeOnOverlayClick={!saving}
      footer={
        <>
          <button
            type="button"
            onClick={resetAndClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit(Boolean(duplicate))}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {saving ? "Saving…" : duplicate ? "Create anyway" : "Save supplier"}
          </button>
        </>
      }
    >
      {error ? (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-3 py-2 rounded-lg text-sm">
          {error}
        </div>
      ) : null}
      {duplicate ? (
        <div className="mb-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 px-3 py-2 rounded-lg text-sm">
          <p>{duplicateNameWarning(duplicate.name)}</p>
          <button
            type="button"
            className="mt-2 text-sm font-medium text-blue-700 dark:text-blue-400 underline"
            onClick={() => {
              onCreated({
                id: duplicate.id,
                business_id: businessId,
                name: duplicate.name,
                phone: null,
                email: null,
                location_line: null,
                tax_id: null,
                status: "active",
              })
              resetAndClose()
            }}
          >
            Select existing supplier
          </button>
        </div>
      ) : null}
      <SupplierFormFields values={values} onChange={setValues} disabled={saving} idPrefix="add-supplier" />
    </Modal>
  )
}
