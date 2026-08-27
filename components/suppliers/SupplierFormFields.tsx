"use client"

import type { SupplierFormValues } from "@/lib/suppliers/createSupplier"

type Props = {
  values: SupplierFormValues
  onChange: (values: SupplierFormValues) => void
  disabled?: boolean
  idPrefix?: string
}

export default function SupplierFormFields({
  values,
  onChange,
  disabled,
  idPrefix = "supplier",
}: Props) {
  const set = (field: keyof SupplierFormValues, value: string) => {
    onChange({ ...values, [field]: value })
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-name`} className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
          Supplier name *
        </label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          disabled={disabled}
          required
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Supplier company name"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${idPrefix}-phone`} className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
            Phone
          </label>
          <input
            id={`${idPrefix}-phone`}
            type="tel"
            value={values.phone || ""}
            onChange={(e) => set("phone", e.target.value)}
            disabled={disabled}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-email`} className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
            Email
          </label>
          <input
            id={`${idPrefix}-email`}
            type="email"
            value={values.email || ""}
            onChange={(e) => set("email", e.target.value)}
            disabled={disabled}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-address`} className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
          Address
        </label>
        <input
          id={`${idPrefix}-address`}
          type="text"
          value={values.location_line || ""}
          onChange={(e) => set("location_line", e.target.value)}
          disabled={disabled}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-tax`} className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
          Tax / TIN / VAT ID
        </label>
        <input
          id={`${idPrefix}-tax`}
          type="text"
          value={values.tax_id || ""}
          onChange={(e) => set("tax_id", e.target.value)}
          disabled={disabled}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  )
}
