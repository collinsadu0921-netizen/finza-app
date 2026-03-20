"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { getCurrencySymbol } from "@/lib/currency"

type PayslipData = {
  id: string
  public_token: string
  sent_at: string | null
  created_at: string | null
  payroll_entries: {
    basic_salary: number
    allowances_total: number
    deductions_total: number
    gross_salary: number
    ssnit_employee: number
    ssnit_employer: number
    taxable_income: number
    paye: number
    net_salary: number
  }
  staff: {
    name: string
    position: string | null
    bank_name: string | null
    bank_account: string | null
    ssnit_number: string | null
    tin_number: string | null
  }
  payroll_runs: {
    payroll_month: string
    status: string
  }
}

type BusinessData = {
  legal_name: string | null
  trading_name: string | null
  phone: string | null
  email: string | null
  address_line1: string | null
  address_city: string | null
  address_country: string | null
  default_currency: string | null
}

function fmt(amount: number, sym: string) {
  return `${sym}${Number(amount).toFixed(2)}`
}

function formatMonth(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-GH", { month: "long", year: "numeric" })
}

export default function PublicPayslipPage() {
  const params = useParams()
  const token = params.token as string
  const [payslip, setPayslip] = useState<PayslipData | null>(null)
  const [business, setBusiness] = useState<BusinessData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!token) return
    fetch(`/api/payroll/payslips/public/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setNotFound(true); return }
        setPayslip(data.payslip)
        setBusiness(data.business)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 text-sm">Loading payslip…</p>
        </div>
      </div>
    )
  }

  if (notFound || !payslip) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Payslip Not Found</h1>
          <p className="text-slate-500 text-sm">This payslip link is invalid or has been removed.</p>
        </div>
      </div>
    )
  }

  const entry = payslip.payroll_entries
  const staff = payslip.staff
  const run = payslip.payroll_runs
  const businessName = business?.trading_name || business?.legal_name || "Your Employer"
  const currencyCode = business?.default_currency ?? null
  const sym = currencyCode ? (getCurrencySymbol(currencyCode) ?? currencyCode) : "₵"
  const payrollMonth = run?.payroll_month ? formatMonth(run.payroll_month) : "N/A"
  const totalStatDeductions = Number(entry.paye ?? 0) + Number(entry.ssnit_employee ?? 0)
  const totalDeductions = totalStatDeductions + Number(entry.deductions_total ?? 0)

  return (
    <div className="min-h-screen bg-slate-100 py-10 px-4 print:bg-white print:py-0">
      <div className="max-w-2xl mx-auto">

        {/* Print button */}
        <div className="flex justify-end mb-4 print:hidden">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print / Save PDF
          </button>
        </div>

        {/* Payslip card */}
        <div className="bg-white rounded-2xl shadow-md overflow-hidden print:shadow-none print:rounded-none">

          {/* Header */}
          <div className="bg-gradient-to-r from-blue-800 to-blue-600 px-8 py-7 text-white">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-blue-200 text-xs font-semibold uppercase tracking-wider mb-1">Payslip</p>
                <h1 className="text-2xl font-bold">{payrollMonth}</h1>
                <p className="text-blue-200 text-sm mt-1">{businessName}</p>
              </div>
              <div className="text-right">
                <p className="text-blue-100 text-xs">Status</p>
                <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full mt-1 ${
                  run.status === "approved" ? "bg-green-400/20 text-green-200 border border-green-300/30" :
                  "bg-yellow-400/20 text-yellow-200 border border-yellow-300/30"
                }`}>
                  {run.status === "approved" ? "Approved" : run.status}
                </span>
              </div>
            </div>
          </div>

          {/* Employee Info */}
          <div className="px-8 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500 mb-0.5">Employee</p>
              <p className="text-lg font-bold text-slate-800">{staff.name}</p>
              {staff.position && <p className="text-sm text-slate-500">{staff.position}</p>}
            </div>
            <div className="space-y-1 sm:text-right text-sm">
              {staff.ssnit_number && (
                <p className="text-slate-500">SSNIT: <span className="font-mono text-slate-700">{staff.ssnit_number}</span></p>
              )}
              {staff.tin_number && (
                <p className="text-slate-500">TIN: <span className="font-mono text-slate-700">{staff.tin_number}</span></p>
              )}
            </div>
          </div>

          <div className="px-8 py-6 space-y-6">

            {/* Earnings */}
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Earnings</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                  <span className="text-sm text-slate-600">Basic Salary</span>
                  <span className="text-sm font-medium text-slate-800">{fmt(entry.basic_salary, sym)}</span>
                </div>
                {Number(entry.allowances_total) > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-slate-50">
                    <span className="text-sm text-slate-600">Allowances</span>
                    <span className="text-sm font-medium text-slate-800">{fmt(entry.allowances_total, sym)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2 bg-slate-50 rounded-lg px-3">
                  <span className="text-sm font-bold text-slate-700">Gross Pay</span>
                  <span className="text-sm font-bold text-slate-800">{fmt(entry.gross_salary, sym)}</span>
                </div>
              </div>
            </div>

            {/* Deductions */}
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Deductions</h3>
              <div className="space-y-2">
                {Number(entry.paye) > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-slate-50">
                    <span className="text-sm text-slate-600">PAYE Income Tax</span>
                    <span className="text-sm font-medium text-red-600">−{fmt(entry.paye, sym)}</span>
                  </div>
                )}
                {Number(entry.ssnit_employee) > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-slate-50">
                    <span className="text-sm text-slate-600">SSNIT (Employee 5.5%)</span>
                    <span className="text-sm font-medium text-red-600">−{fmt(entry.ssnit_employee, sym)}</span>
                  </div>
                )}
                {Number(entry.deductions_total) > 0 && (
                  <div className="flex justify-between items-center py-2 border-b border-slate-50">
                    <span className="text-sm text-slate-600">Other Deductions</span>
                    <span className="text-sm font-medium text-red-600">−{fmt(entry.deductions_total, sym)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2 bg-red-50 rounded-lg px-3">
                  <span className="text-sm font-bold text-red-700">Total Deductions</span>
                  <span className="text-sm font-bold text-red-700">−{fmt(totalDeductions, sym)}</span>
                </div>
              </div>
            </div>

            {/* Employer contribution note */}
            {Number(entry.ssnit_employer) > 0 && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
                <p className="text-xs text-blue-700">
                  <strong>Employer SSNIT Contribution:</strong> {fmt(entry.ssnit_employer, sym)} (13% — paid by employer, not deducted from your salary)
                </p>
              </div>
            )}

            {/* Net Pay */}
            <div className="bg-green-50 border border-green-200 rounded-xl px-6 py-5">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-semibold text-green-700">Net Pay</p>
                  <p className="text-xs text-green-600 mt-0.5">Amount to be paid to employee</p>
                </div>
                <p className="text-3xl font-bold text-green-700">{fmt(entry.net_salary, sym)}</p>
              </div>
              {(staff.bank_name || staff.bank_account) && (
                <p className="text-xs text-green-600 mt-3 pt-3 border-t border-green-200">
                  Payment to: <span className="font-medium">{staff.bank_name || ""}{staff.bank_account ? ` — ${staff.bank_account}` : ""}</span>
                </p>
              )}
            </div>

            {/* Taxable income note */}
            {Number(entry.taxable_income) > 0 && (
              <p className="text-xs text-slate-400 text-center">
                Taxable income: {fmt(entry.taxable_income, sym)}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="px-8 py-4 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-xs text-slate-400">Generated by {businessName} via Finza</p>
            <p className="text-xs text-slate-400">
              {payslip.sent_at ? `Issued ${new Date(payslip.sent_at).toLocaleDateString("en-GH")}` : ""}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
