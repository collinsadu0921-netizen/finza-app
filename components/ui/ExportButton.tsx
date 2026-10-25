import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from "react"

export type ExportButtonVariant = "csv" | "pdf" | "print" | "neutral"

const BASE_CLASSES =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium bg-white dark:bg-gray-800 transition-colors disabled:cursor-not-allowed disabled:opacity-50"

const VARIANT_CLASSES: Record<ExportButtonVariant, string> = {
  csv: "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700",
  neutral:
    "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700",
  print:
    "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700",
  pdf: "border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20",
}

function ExportIcon({ variant }: { variant: ExportButtonVariant }) {
  if (variant === "pdf") {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
    )
  }

  if (variant === "print") {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
        />
      </svg>
    )
  }

  if (variant === "csv") {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
        />
      </svg>
    )
  }

  return null
}

export function exportButtonClassName(
  variant: ExportButtonVariant = "neutral",
  className = ""
): string {
  return `${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${className}`.trim()
}

type ExportButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ExportButtonVariant
  children: ReactNode
  icon?: ReactNode
}

export function ExportButton({
  variant = "neutral",
  children,
  className = "",
  icon,
  type = "button",
  ...props
}: ExportButtonProps) {
  return (
    <button type={type} className={exportButtonClassName(variant, className)} {...props}>
      {icon ?? <ExportIcon variant={variant} />}
      {children}
    </button>
  )
}

type ExportLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ExportButtonVariant
  children: ReactNode
  icon?: ReactNode
}

export function ExportLink({
  variant = "neutral",
  children,
  className = "",
  icon,
  ...props
}: ExportLinkProps) {
  return (
    <a className={exportButtonClassName(variant, className)} {...props}>
      {icon ?? <ExportIcon variant={variant} />}
      {children}
    </a>
  )
}
