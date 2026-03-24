import type { ReactNode } from "react"

/**
 * Customer block aligned with `/pay/[invoiceId]/view` (public invoice document).
 * Used on public quote and proforma pages for consistent “Bill To” presentation.
 */
export type PublicBillToCustomer = {
  name: string
  email: string | null
  phone: string | null
  address: string | null
  tin?: string | null
  whatsapp_phone?: string | null
}

export function PublicDocumentMetaRow({
  cells,
}: {
  cells: { label: string; value: ReactNode }[]
}) {
  return (
    <div className="px-8 py-5 bg-gray-50 border-b border-gray-100 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
      {cells.map((c, i) => (
        <div key={i}>
          <p className="text-gray-500 uppercase text-xs tracking-wide font-medium mb-0.5">{c.label}</p>
          <p className="font-semibold text-gray-800">{c.value}</p>
        </div>
      ))}
    </div>
  )
}

export function PublicBillToBlock({ customer }: { customer: PublicBillToCustomer | null }) {
  return (
    <div className="px-8 py-5 border-b border-gray-100">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Bill To</p>
      {customer ? (
        <div className="text-sm">
          <p className="font-semibold text-gray-900 text-base">{customer.name}</p>
          {customer.address && (
            <p className="text-gray-500 mt-0.5 whitespace-pre-line">{customer.address}</p>
          )}
          {customer.email && <p className="text-gray-500">{customer.email}</p>}
          {customer.phone && <p className="text-gray-500">{customer.phone}</p>}
          {customer.whatsapp_phone &&
            customer.whatsapp_phone.trim() !== (customer.phone ?? "").trim() && (
              <p className="text-gray-500">WhatsApp: {customer.whatsapp_phone}</p>
            )}
          {customer.tin && <p className="text-gray-500">TIN: {customer.tin}</p>}
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">No customer</p>
      )}
    </div>
  )
}
