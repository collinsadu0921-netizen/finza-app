"use client"

import type { LucideIcon } from "lucide-react"
import {
  Activity,
  ArrowLeftRight,
  BadgeCent,
  BookOpen,
  Boxes,
  Briefcase,
  Building2,
  CalendarRange,
  Calculator,
  ClipboardList,
  CreditCard,
  FileMinus,
  FileSearch,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  GitMerge,
  HandCoins,
  Handshake,
  Inbox,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  ListTree,
  Mail,
  PieChart,
  ReceiptText,
  Repeat,
  Scale,
  ScrollText,
  Send,
  Settings,
  TrendingUp,
  Users,
  UsersRound,
  Wallet,
  Warehouse,
  Waves,
  Wrench,
} from "lucide-react"

/** Ghana cedi mark — matches Lucide h-4 w-4 nav icon slot (no dollar-sign glyph). */
export function ServiceSidebarCediMark({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center text-[13px] font-bold leading-none tabular-nums ${className ?? ""}`}
      aria-hidden="true"
    >
      ₵
    </span>
  )
}

/** Receipt silhouette + official Ghana cedi glyph (U+20B5). Hand-drawn beziers read as “q”; real ₵ must use font outlines. */
export function ServiceSidebarInvoiceCediIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      shapeRendering="geometricPrecision"
    >
      {/* Slight inset so the rim stroke matches sibling Lucide icons */}
      <g transform="translate(12 12) scale(0.92) translate(-12 -12)">
        <path
          d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      {/* Unicode ₵ — user-agent renders correct capital-C-plus-bar shape (single SVG user-unit size, no px) */}
      <text
        x={12}
        y={12}
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        fontSize={10.25}
        fontWeight={700}
        fontFamily='ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
      >
        ₵
      </text>
    </svg>
  )
}

export type ServiceSidebarNavIconResult = LucideIcon | "cedi" | "invoice_cedi" | null

/** Lucide icon per Service sidebar label (exact match). Payroll uses cedi mark separately. */
const SERVICE_SIDEBAR_ICON_BY_LABEL: Record<string, LucideIcon> = {
  Dashboard: LayoutDashboard,
  Customers: Users,
  Quotes: FileText,
  Proposals: Send,
  "Jobs & Projects": Briefcase,
  Services: Wrench,
  Materials: Boxes,
  "Proforma Invoices": FileSpreadsheet,
  "Recurring invoices": Repeat,
  Payments: Wallet,
  "Credit Notes": FileMinus,
  Expenses: ReceiptText,
  "Supplier Bills": ClipboardList,
  "Incoming documents": Inbox,
  Employees: UsersRound,
  "Salary Advances": HandCoins,
  "Profit & Loss": TrendingUp,
  "Balance Sheet": Scale,
  "Cash Flow": Waves,
  "Changes in Equity": ArrowLeftRight,
  "Fixed Assets": Warehouse,
  "VAT Report": PieChart,
  "VAT Filings": FolderKanban,
  "Withholding Tax": BadgeCent,
  "CIT Provisions": Calculator,
  "General Ledger": BookOpen,
  "Chart of Accounts": ListTree,
  "Trial Balance": ListChecks,
  Reconciliation: GitMerge,
  "Bank Reconciliation": Landmark,
  "Accounting Periods": CalendarRange,
  Health: Activity,
  "Control Tower": LayoutGrid,
  "Forensic Runs": FileSearch,
  Tenants: Building2,
  "Loans & Equity": Handshake,
  "Accounting Audit Log": ScrollText,
  "Team members": UsersRound,
  "Accountant requests": Mail,
  "All settings": Settings,
  "Subscription & plan": CreditCard,
  "Full Audit Log": FileSearch,
}

export function getServiceSidebarNavIcon(label: string): ServiceSidebarNavIconResult {
  if (label === "Payroll") return "cedi"
  if (label === "Invoices") return "invoice_cedi"
  return SERVICE_SIDEBAR_ICON_BY_LABEL[label] ?? null
}
