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
  Receipt,
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

export type ServiceSidebarNavIconResult = LucideIcon | "cedi" | null

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
  Invoices: Receipt,
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
  return SERVICE_SIDEBAR_ICON_BY_LABEL[label] ?? null
}
