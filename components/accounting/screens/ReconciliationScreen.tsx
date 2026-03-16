"use client"

/**
 * Reconciliation — admin-only. Mismatches between operational balances and ledger AR.
 * No auto-post; clear confirmation before posting. Every approval attributable to user.
 */

import { useState, useEffect, useCallback } from "react"
import EmptyState from "@/components/ui/EmptyState"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { formatMoney } from "@/lib/money"
import { useToast } from "@/components/ui/ToastProvider"
import ReconciliationConfirmPostModal from "@/components/accounting/ReconciliationConfirmPostModal"
import Button from "@/components/ui/Button"
import {
  ACCOUNTING_NOT_INITIALIZED_TITLE,
  ACCOUNTING_NOT_INITIALIZED_DESCRIPTION,
  ACCOUNTING_NOT_INITIALIZED_ACCOUNTANT_SECONDARY,
} from "@/lib/accounting/useAccountingReadiness"
import ReadinessBanner from "@/components/accounting/ReadinessBanner"
import { buildServiceRoute } from "@/lib/service/routes"
import type { ScreenProps } from "./types"

type Scope = { businessId: string; invoiceId?: string; customerId?: string; periodId?: string }
type Result = {
  scope: Scope
  expectedBalance: number
  ledgerBalance: number
  delta: number
  status: string
}
type CauseWithConfidence = { cause: string; confidence: string }
type DiagnosisStrict = {
  classification: string
  possible_causes: CauseWithConfidence[]
  evidence: string[]
  summary: string
}
type JELine = { account_code: string; debit: number; credit: number }
type ProposedJE = {
  posting_source: string
  description: string
  reference_type: string
  reference_id: string
  lines: JELine[]
}
type ProposedFixStrict = { pattern: string; journal_entry: ProposedJE }
type AuditMetadataStrict = {
  reason: string
  detected_delta: number
  before_balance: number
  after_balance: number
  confidence_level: string
  approval_required: boolean
}
type LedgerCorrectionProposal = {
  diagnosis: DiagnosisStrict
  proposed_fix: ProposedFixStrict | null
  audit_metadata: AuditMetadataStrict
  verification_plan: { reconciliation_to_re_run: string; expected_delta: number; expected_status: string }
}
type MismatchRow = { result: Result; proposal: LedgerCorrectionProposal; proposal_hash?: string }
type Policy = {
  adjustment_requires_accountant: boolean
  adjustment_requires_owner_over_amount: number
  adjustment_requires_two_person_rule: boolean
}
type PendingApproval = {
  scope_type: string
  scope_id: string
  proposal_hash: string
  delta: number
  approval_count: number
  first_approver: { approved_by: string; approved_at: string; approver_role: string }
}

function scopeLabel(scope: Scope): string {
  if (scope.invoiceId) return `Invoice ${scope.invoiceId.slice(0, 8)}…`
  if (scope.customerId) return `Customer ${scope.customerId.slice(0, 8)}…`
  if (scope.periodId) return `Period ${scope.periodId.slice(0, 8)}…`
  return `Business ${scope.businessId.slice(0, 8)}…`
}

export default function ReconciliationScreen({ mode, businessId: businessIdProp }: ScreenProps) {
  const businessId = businessIdProp
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [currencyCode, setCurrencyCode] = useState<string | null>(null)
  const [mismatches, setMismatches] = useState<MismatchRow[]>([])
  const [canPostLedger, setCanPostLedger] = useState(false)
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<MismatchRow | null>(null)
  const [posting, setPosting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [approveOnly, setApproveOnly] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [resolutionHistory, setResolutionHistory] = useState<{
    resolution: { approved_by: string; approved_at: string; journal_entry_id: string | null; reference_id: string } | null
    approvals: Array<{ approved_by: string; approved_at: string; approver_role: string }>
  } | null>(null)
  const noContext = !businessId
  const routeContextOk = !!businessId
  const [readiness, setReadiness] = useState<{ ready: boolean; authority_source: string | null } | null>(null)
  const [readinessLoading, setReadinessLoading] = useState(true)

  useEffect(() => {
    if (!businessId) {
      setLoading(false)
      return
    }
  }, [businessId])

  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user && !cancelled) setUserId(user.id)
    })
    supabase.from("businesses").select("default_currency").eq("id", businessId).maybeSingle().then(({ data: business }) => {
      if (!cancelled) setCurrencyCode((business as { default_currency?: string } | null)?.default_currency ?? null)
    })
    return () => { cancelled = true }
  }, [businessId])

  const loadMismatches = useCallback(async () => {
    if (!businessId) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      setError("")
      const res = await fetch(`/api/accounting/reconciliation/mismatches?businessId=${encodeURIComponent(businessId)}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || res.statusText)
      }
      const data = await res.json()
      const list = data.mismatches ?? []
      setMismatches(list)
      setCanPostLedger(data.canPostLedger === true)
      setPolicy(data.policy ?? null)
      setUserRole(data.userRole ?? null)
      if (selected && !list.some((m: MismatchRow) => m.result.scope.invoiceId === selected.result.scope.invoiceId)) {
        setSelected(null)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load mismatches"
      setError(msg)
      setMismatches([])
    } finally {
      setLoading(false)
    }
  }, [businessId, selected?.result.scope.invoiceId])

  useEffect(() => {
    if (businessId) loadMismatches()
  }, [businessId, loadMismatches])

  useEffect(() => {
    if (!businessId) {
      setReadiness(null)
      setReadinessLoading(false)
      return
    }
    setReadinessLoading(true)
    fetch(`/api/accounting/readiness?business_id=${encodeURIComponent(businessId)}`)
      .then((res) => res.json())
      .then((data) => {
        setReadiness({
          ready: data.ready === true,
          authority_source: data.authority_source ?? null,
        })
      })
      .catch(() => setReadiness({ ready: false, authority_source: null }))
      .finally(() => setReadinessLoading(false))
  }, [businessId])

  const loadPendingApprovals = useCallback(async () => {
    if (!businessId) return
    try {
      const res = await fetch(`/api/accounting/reconciliation/pending-approvals?businessId=${encodeURIComponent(businessId)}`)
      if (res.ok) {
        const data = await res.json()
        setPendingApprovals(data.pending ?? [])
      }
    } catch {
      setPendingApprovals([])
    }
  }, [businessId])

  useEffect(() => {
    if (businessId) loadPendingApprovals()
  }, [businessId, loadPendingApprovals])

  const loadResolutionHistory = useCallback(async () => {
    if (!selected?.result.scope.invoiceId || !businessId) {
      setResolutionHistory(null)
      return
    }
    try {
      const res = await fetch(
        `/api/accounting/reconciliation/resolution-history?businessId=${encodeURIComponent(businessId)}&scopeType=invoice&scopeId=${encodeURIComponent(selected.result.scope.invoiceId)}`
      )
      if (res.ok) {
        const data = await res.json()
        setResolutionHistory(data)
      } else {
        setResolutionHistory(null)
      }
    } catch {
      setResolutionHistory(null)
    }
  }, [selected?.result.scope.invoiceId, businessId])

  useEffect(() => {
    if (selected?.result.scope.invoiceId) {
      loadResolutionHistory()
    } else {
      setResolutionHistory(null)
    }
  }, [selected?.result.scope.invoiceId, loadResolutionHistory])

  const handleApproveClick = (approveOnlyFirst = false) => {
    if (!selected?.result || !selected?.proposal?.proposed_fix) return
    setApproveOnly(approveOnlyFirst)
    setConfirmOpen(true)
  }

  const handleConfirmPost = async () => {
    const proposalHash = selected?.proposal_hash ?? null
    if (!selected?.result || !selected?.proposal?.proposed_fix || !businessId || !proposalHash) return
    setPosting(true)
    try {
      const body = {
        businessId,
        scopeType: "invoice" as const,
        scopeId: selected.result.scope.invoiceId!,
        proposed_fix: selected.proposal.proposed_fix,
        proposal_hash: proposalHash,
        approve_only: approveOnly,
        clientSeen: {
          detected_delta: selected.result.delta,
          ledgerBalance: selected.result.ledgerBalance,
          expectedBalance: selected.result.expectedBalance,
        },
      }
      const res = await fetch("/api/accounting/reconciliation/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 409 && data.error === "STALE_RECONCILIATION" && data.result && data.proposal) {
        setSelected({
          result: data.result,
          proposal: data.proposal,
          proposal_hash: data.proposal_hash ?? undefined,
        })
        showToast("Reconciliation state changed. Please review the updated proposal before posting.", "warning")
        setConfirmOpen(false)
        return
      }

      if (res.status === 403 && data.awaiting_owner_approval) {
        showToast("This adjustment requires owner approval.", "warning")
        setConfirmOpen(false)
        return
      }
      if (res.status === 403 && data.awaiting_second_approval !== undefined) {
        showToast(data.error || "A second approver is required.", "warning")
        setConfirmOpen(false)
        return
      }

      if (!res.ok) {
        throw new Error(data.error || data.message || "Post failed")
      }
      setConfirmOpen(false)
      setSelected(null)
      await loadMismatches()
      await loadPendingApprovals()
      if (data.posted === false && data.awaiting_second_approval) {
        showToast("Approval recorded. Awaiting second approver.", "success")
      } else if (data.posted === false) {
        showToast("Approval recorded.", "success")
      } else {
        showToast("Adjustment posted successfully.", "success")
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to post"
      setError(msg)
      showToast(msg, "error")
    } finally {
      setPosting(false)
    }
  }

  const handleRejectDefer = () => {
    setSelected(null)
  }

  if (!routeContextOk || (!loading && noContext)) {
    return (
      
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-6 text-amber-800 dark:text-amber-200">
              <p className="font-medium">Select a client or ensure you have an active business.</p>
              <p className="text-sm mt-1">No business context is available.</p>
            </div>
          </div>
        </div>
      
    )
  }

  if (!readinessLoading && readiness && readiness.authority_source === "accountant" && !readiness.ready) {
    return (
      
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <EmptyState
            title={ACCOUNTING_NOT_INITIALIZED_TITLE}
            description={ACCOUNTING_NOT_INITIALIZED_DESCRIPTION}
          />
          <p className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
            {ACCOUNTING_NOT_INITIALIZED_ACCOUNTANT_SECONDARY}
          </p>
        </div>
      
    )
  }

  return (
    
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <ReadinessBanner
            ready={readiness?.ready ?? null}
            authoritySource={(readiness?.authority_source ?? null) as "accountant" | "owner" | "employee" | null}
            businessId={businessId}
            onInitSuccess={() => window.location.reload()}
          />
          <div className="mb-6">
            <button
              onClick={() => router.push(mode === "service" ? buildServiceRoute("/service/accounting", businessId) : (businessId ? `/accounting?business_id=${businessId}` : "/accounting"))}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-2 text-sm"
            >
              ← Back to Accounting
            </button>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Reconciliation</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Mismatches between operational balances and ledger AR
            </p>
          </div>

          {error && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-red-800 dark:text-red-200 text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left: Mismatch list (table) */}
              <div className="lg:col-span-2">
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Scope</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Status</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Delta</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Confidence</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {mismatches.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
                              No discrepancies detected
                            </td>
                          </tr>
                        ) : (
                          mismatches.map((row, i) => (
                            <tr
                              key={row.result.scope.invoiceId ?? row.result.scope.customerId ?? i}
                              className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${selected?.result.scope.invoiceId === row.result.scope.invoiceId ? "bg-blue-50 dark:bg-blue-900/20" : ""}`}
                            >
                              <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                                {scopeLabel(row.result.scope)}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-xs font-medium px-2 py-0.5 rounded ${row.result.status === "FAIL" ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200" : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"}`}>
                                  {row.result.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300 tabular-nums">
                                {formatMoney(row.result.delta, currencyCode ?? undefined)}
                              </td>
                              <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                                {row.proposal.audit_metadata.confidence_level}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>
                                  View
                                </Button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Right: Detail panel */}
              <div className="lg:col-span-1">
                {selected ? (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 font-medium text-gray-900 dark:text-white flex justify-between items-center">
                      <span>Detail</span>
                      <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-sm">Close</button>
                    </div>

                    <div className="px-4 pb-4 space-y-4 overflow-y-auto max-h-[calc(100vh-280px)]">
                      {/* 1) Why this mismatch exists */}
                      <section>
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Why this mismatch exists</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{selected.proposal.diagnosis.summary || "No summary available."}</p>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Confidence:</span>
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded ${
                              selected.proposal.audit_metadata.confidence_level === "HIGH"
                                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200"
                                : selected.proposal.audit_metadata.confidence_level === "MEDIUM"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                                : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                            }`}
                          >
                            {selected.proposal.audit_metadata.confidence_level}
                          </span>
                        </div>
                        {selected.proposal.diagnosis.evidence.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Evidence:</p>
                            <ul className="text-xs text-gray-600 dark:text-gray-400 list-disc list-inside space-y-0.5">
                              {selected.proposal.diagnosis.evidence.slice(0, 5).map((e, i) => (
                                <li key={i}>{e}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </section>

                      {/* 2) Document trace links */}
                      {selected.result.scope.invoiceId && (
                        <section>
                          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Related documents</h3>
                          <div className="flex flex-col gap-1.5">
                            <a
                              href={`/invoices/${selected.result.scope.invoiceId}/view`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                            >
                              <span>📄</span>
                              <span>View Invoice</span>
                            </a>
                            {resolutionHistory?.resolution?.journal_entry_id && (
                              <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1">
                                <span>📋</span>
                                <span>
                                  Journal Entry: <span className="font-mono">{resolutionHistory.resolution.journal_entry_id.slice(0, 8)}…</span>
                                </span>
                              </div>
                            )}
                          </div>
                        </section>
                      )}

                      {/* 3) Before / After ledger impact */}
                      <section>
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Before / After ledger impact</h3>
                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 p-3 space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600 dark:text-gray-400">Before balance:</span>
                            <span className="text-sm font-medium tabular-nums text-gray-900 dark:text-white">
                              {formatMoney(selected.result.ledgerBalance, currencyCode ?? undefined)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-gray-600 dark:text-gray-400">After balance:</span>
                            <span className="text-sm font-medium tabular-nums text-gray-900 dark:text-white">
                              {formatMoney(selected.result.expectedBalance, currencyCode ?? undefined)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-600">
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Delta:</span>
                            <span
                              className={`text-sm font-semibold tabular-nums ${
                                Math.abs(selected.result.delta) < 0.01
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-amber-600 dark:text-amber-400"
                              }`}
                            >
                              {formatMoney(selected.result.delta, currencyCode ?? undefined)}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">
                          This is what will change if approved. A new journal entry will be created; no existing entry is modified.
                        </p>
                      </section>

                      {/* 4) Diagnosis (legacy section - kept for compatibility) */}
                      <section className="hidden">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Diagnosis</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{selected.proposal.diagnosis.summary}</p>
                        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1 mb-2">
                          {selected.proposal.diagnosis.possible_causes.map((c, i) => (
                            <div key={i}>{c.cause} ({c.confidence})</div>
                          ))}
                        </div>
                        <ul className="text-xs text-gray-500 dark:text-gray-400 list-disc list-inside space-y-0.5">
                          {selected.proposal.diagnosis.evidence.slice(0, 5).map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      </section>

                      {/* 5) Proposed Fix */}
                      <section>
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Proposed Fix</h3>
                        {resolutionHistory?.resolution ? (
                          <div className="rounded border-2 border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-900/20 px-3 py-2 text-green-800 dark:text-green-200 text-sm font-semibold mb-3 text-center">
                            POSTED
                          </div>
                        ) : (
                          <div className="rounded border-2 border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-amber-800 dark:text-amber-200 text-sm font-semibold mb-3 text-center">
                            NOT POSTED
                          </div>
                        )}
                        {selected.proposal.proposed_fix && (
                          <>
                            <p className="text-sm text-gray-600 dark:text-gray-400">{selected.proposal.proposed_fix.journal_entry.description}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              Posting source: {selected.proposal.proposed_fix.journal_entry.posting_source}
                            </p>
                            <div className="mt-2 overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-gray-200 dark:border-gray-600">
                                    <th className="text-left py-1.5 font-medium">account_code</th>
                                    <th className="text-right py-1.5 font-medium">debit</th>
                                    <th className="text-right py-1.5 font-medium">credit</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {selected.proposal.proposed_fix.journal_entry.lines.map((l, i) => (
                                    <tr key={i} className="border-b border-gray-100 dark:border-gray-700">
                                      <td className="py-1.5">{l.account_code}</td>
                                      <td className="text-right tabular-nums">{l.debit > 0 ? l.debit.toFixed(2) : "—"}</td>
                                      <td className="text-right tabular-nums">{l.credit > 0 ? l.credit.toFixed(2) : "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-medium bg-gray-50 dark:bg-gray-700/50">
                                    <td className="py-1.5">Total</td>
                                    <td className="text-right tabular-nums">
                                      {selected.proposal.proposed_fix.journal_entry.lines.reduce((s, l) => s + (l.debit || 0), 0).toFixed(2)}
                                    </td>
                                    <td className="text-right tabular-nums">
                                      {selected.proposal.proposed_fix.journal_entry.lines.reduce((s, l) => s + (l.credit || 0), 0).toFixed(2)}
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </>
                        )}
                      </section>

                      {/* 6) Status timeline */}
                      {(resolutionHistory?.resolution || (resolutionHistory?.approvals && resolutionHistory.approvals.length > 0)) && (
                        <section>
                          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Status timeline</h3>
                          <div className="space-y-2">
                            {resolutionHistory.approvals.length > 0 && (
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                <span className="font-medium">Detected at</span>
                                <span className="text-gray-500 dark:text-gray-500 ml-2">
                                  {new Date(resolutionHistory.approvals[0].approved_at).toLocaleString()}
                                </span>
                              </div>
                            )}
                            {resolutionHistory.approvals.map((approval, i) => (
                              <div key={i} className="text-xs text-gray-600 dark:text-gray-400">
                                <span className="font-medium">Approved by {approval.approver_role}</span>
                                <span className="text-gray-500 dark:text-gray-500 ml-2">
                                  {new Date(approval.approved_at).toLocaleString()}
                                </span>
                              </div>
                            ))}
                            {resolutionHistory.resolution && (
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                <span className="font-medium">Posted at</span>
                                <span className="text-gray-500 dark:text-gray-500 ml-2">
                                  {new Date(resolutionHistory.resolution.approved_at).toLocaleString()}
                                </span>
                              </div>
                            )}
                          </div>
                        </section>
                      )}

                      {/* 7) Audit metadata (collapsed by default) */}
                      <details className="text-xs">
                        <summary className="text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                          Show audit metadata
                        </summary>
                        <dl className="mt-2 space-y-1">
                          <div className="flex justify-between"><dt className="text-gray-500">detected_delta</dt><dd className="tabular-nums">{selected.proposal.audit_metadata.detected_delta.toFixed(2)}</dd></div>
                          <div className="flex justify-between"><dt className="text-gray-500">before_balance</dt><dd className="tabular-nums">{selected.proposal.audit_metadata.before_balance.toFixed(2)}</dd></div>
                          <div className="flex justify-between"><dt className="text-gray-500">after_balance</dt><dd className="tabular-nums">{selected.proposal.audit_metadata.after_balance.toFixed(2)}</dd></div>
                          <div className="flex justify-between"><dt className="text-gray-500">approval_required</dt><dd>{String(selected.proposal.audit_metadata.approval_required)}</dd></div>
                        </dl>
                      </details>

                      {/* 4) Actions */}
                      <section className="pt-2 border-t border-gray-200 dark:border-gray-700">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Actions</h3>
                        {!canPostLedger ? (
                          <div
                            className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 text-amber-800 dark:text-amber-200 text-sm"
                            title="Only accountants can post ledger adjustments"
                          >
                            Read-only. Only accountants can post ledger adjustments.
                          </div>
                        ) : policy && policy.adjustment_requires_owner_over_amount > 0 && Math.abs(selected.result.delta) > policy.adjustment_requires_owner_over_amount && userRole !== "owner" ? (
                          <div
                            className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 text-amber-800 dark:text-amber-200 text-sm"
                            title="Adjustments above threshold require owner approval"
                          >
                            Awaiting owner approval. Only the owner can post this adjustment.
                          </div>
                        ) : selected?.proposal_hash && policy?.adjustment_requires_two_person_rule ? (() => {
                          const pendingForThis = pendingApprovals.find(
                            (p) => p.scope_id === selected.result.scope.invoiceId && p.proposal_hash === selected.proposal_hash
                          )
                          const isFirstApprover = pendingForThis && userId && pendingForThis.first_approver.approved_by === userId
                          if (pendingForThis && isFirstApprover) {
                            return (
                              <div
                                className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2.5 text-blue-800 dark:text-blue-200 text-sm"
                                title="A second approver must post"
                              >
                                Awaiting second approver. You have already approved; another user must Approve & Post.
                              </div>
                            )
                          }
                          return (
                            <div className="flex flex-col gap-2">
                              {pendingForThis ? (
                                <p className="text-xs text-gray-500 dark:text-gray-400">One approval recorded. You may post as second approver.</p>
                              ) : (
                                <p className="text-xs text-gray-500 dark:text-gray-400">Two-person rule: first approver records approval only; second approver posts.</p>
                              )}
                              <div className="flex gap-3">
                                {!pendingForThis && (
                                  <Button
                                    variant="outline"
                                    size="md"
                                    onClick={() => handleApproveClick(true)}
                                    disabled={posting || !selected.proposal.proposed_fix}
                                    isLoading={posting}
                                    className="flex-1"
                                  >
                                    Approve only (first)
                                  </Button>
                                )}
                                <Button
                                  variant="primary"
                                  size="md"
                                  onClick={() => handleApproveClick(false)}
                                  disabled={posting || !selected.proposal.proposed_fix}
                                  isLoading={posting}
                                  className="flex-1"
                                >
                                  Post ledger adjustment (immutable)
                                </Button>
                                <Button variant="outline" size="md" onClick={handleRejectDefer} className="flex-1">
                                  Reject / Defer
                                </Button>
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                A new journal entry will be created. No existing entry is modified.
                              </p>
                            </div>
                          )
                        })() : (
                          <div className="flex flex-col gap-2">
                            <div className="flex gap-3">
                              <Button
                                variant="primary"
                                size="md"
                                onClick={() => handleApproveClick(false)}
                                disabled={posting || !selected.proposal.proposed_fix || !selected.proposal_hash}
                                isLoading={posting}
                                className="flex-1"
                              >
                                Post ledger adjustment (immutable)
                              </Button>
                              <Button variant="outline" size="md" onClick={handleRejectDefer} className="flex-1">
                                Reject / Defer
                              </Button>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              A new journal entry will be created. No existing entry is modified.
                            </p>
                          </div>
                        )}
                      </section>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 p-8 text-center text-gray-500 dark:text-gray-400 text-sm">
                    Select a row to view diagnosis and proposed fix.
                  </div>
                )}
              </div>
            </div>
          )}

          <ReconciliationConfirmPostModal
            isOpen={confirmOpen}
            onClose={() => !posting && setConfirmOpen(false)}
            onConfirm={handleConfirmPost}
            isPosting={posting}
            approveOnly={approveOnly}
          />
        </div>
      </div>
    
  )
}

