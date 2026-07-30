import {
  buildEmployeePayeSubBreakdown,
  formatGhanaIncomeTaxMethodLabel,
  formatPayrollMoney,
  hasGhanaV3IncomeTaxSnapshot,
  type GhanaIncomeTaxEntryFields,
} from "@/lib/payroll/ghanaIncomeTaxDisplay"

type Props = {
  entry: GhanaIncomeTaxEntryFields
  variant: "admin" | "employee"
  currencySymbol?: string
  className?: string
}

function AdminRow({
  label,
  base,
  amount,
  currencySymbol,
}: {
  label: string
  base: number | null | undefined
  amount: number | null | undefined
  currencySymbol: string
}) {
  const baseNum = Number(base ?? 0)
  const amountNum = Number(amount ?? 0)
  if (baseNum === 0 && amountNum === 0) return null

  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-gray-600 dark:text-gray-400">{label}</span>
      <span className="tabular-nums text-gray-800 dark:text-gray-200 text-right">
        {formatPayrollMoney(amountNum, currencySymbol)}
        {baseNum > 0 ? (
          <span className="text-gray-500 dark:text-gray-400"> · base {formatPayrollMoney(baseNum, currencySymbol)}</span>
        ) : null}
      </span>
    </div>
  )
}

export default function GhanaV3IncomeTaxBreakdown({
  entry,
  variant,
  currencySymbol = "₵",
  className = "",
}: Props) {
  if (variant === "employee") {
    const lines = buildEmployeePayeSubBreakdown(entry, currencySymbol)
    if (lines.length === 0) return null

    return (
      <div className={`text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 space-y-1 ${className}`}>
        {lines.map((line) => (
          <div key={line.label}>
            {line.label}: {line.detail}
          </div>
        ))}
      </div>
    )
  }

  if (!hasGhanaV3IncomeTaxSnapshot(entry)) return null

  const method = String(entry.income_tax_method || "").trim()
  const methodVersion = entry.income_tax_method_version ? String(entry.income_tax_method_version) : "—"
  const totalPaye = Number(entry.paye ?? 0)

  return (
    <div
      className={`rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40 px-3 py-2 space-y-1.5 ${className}`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Ghana v3 income tax
      </div>
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-gray-600 dark:text-gray-400">Tax method</span>
        <span className="text-gray-800 dark:text-gray-200 text-right">{formatGhanaIncomeTaxMethodLabel(method)}</span>
      </div>
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-gray-600 dark:text-gray-400">Method version</span>
        <span className="font-mono text-gray-800 dark:text-gray-200 text-right">{methodVersion}</span>
      </div>
      <AdminRow
        label="Regular tax"
        base={entry.income_tax_regular_base}
        amount={entry.income_tax_regular_amount}
        currencySymbol={currencySymbol}
      />
      <AdminRow
        label="Bonus tax"
        base={entry.income_tax_bonus_base}
        amount={entry.income_tax_bonus_amount}
        currencySymbol={currencySymbol}
      />
      <AdminRow
        label="Overtime tax"
        base={entry.income_tax_overtime_base}
        amount={entry.income_tax_overtime_amount}
        currencySymbol={currencySymbol}
      />
      <div className="flex justify-between gap-3 text-xs pt-1 border-t border-slate-200 dark:border-slate-700">
        <span className="font-medium text-gray-700 dark:text-gray-300">Total PAYE</span>
        <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">
          {formatPayrollMoney(totalPaye, currencySymbol)}
        </span>
      </div>
    </div>
  )
}
