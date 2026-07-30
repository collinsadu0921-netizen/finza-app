import Link from "next/link"
import {
  PAYROLL_BUSINESS_TIN_APPROVED_BODY,
  PAYROLL_BUSINESS_TIN_APPROVED_TITLE,
  PAYROLL_BUSINESS_TIN_DRAFT_BODY,
  PAYROLL_BUSINESS_TIN_DRAFT_TITLE,
  resolveCompanySettingsPath,
} from "@/lib/payroll/payrollBusinessTinWarning"

type Props = {
  variant: "draft_missing" | "approved_snapshot_missing"
  payrollBasePath: string
  className?: string
}

export default function PayrollBusinessTinWarning({ variant, payrollBasePath, className = "" }: Props) {
  const settingsHref = resolveCompanySettingsPath(payrollBasePath)
  const title =
    variant === "draft_missing"
      ? PAYROLL_BUSINESS_TIN_DRAFT_TITLE
      : PAYROLL_BUSINESS_TIN_APPROVED_TITLE
  const body =
    variant === "draft_missing"
      ? PAYROLL_BUSINESS_TIN_DRAFT_BODY
      : PAYROLL_BUSINESS_TIN_APPROVED_BODY

  return (
    <div
      className={`rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 ${className}`}
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1">{body}</p>
      <Link
        href={settingsHref}
        className="mt-2 inline-block text-sm font-medium text-amber-900 underline underline-offset-2 hover:text-amber-950 dark:text-amber-100 dark:hover:text-white"
      >
        Open Company Settings
      </Link>
    </div>
  )
}
