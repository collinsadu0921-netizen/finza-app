"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import type { ProposalListRow } from "@/lib/proposals/proposalListApi"
import {
  PROPOSAL_STATUS_LABEL,
  normalizeProposalStatus,
  proposalCanBeEditedByStaff,
  type ProposalStatus,
} from "@/lib/proposals/proposalState"

export default function ServiceProposalsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<ProposalListRow[]>([])
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, totalCount: 0, totalPages: 0 })
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError("")
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          setError("Not logged in")
          return
        }
        const business = await getCurrentBusiness(supabase, user.id)
        if (!business) {
          setError("Business not found")
          return
        }
        if (!cancelled) setBusinessId(business.id)
        const qs = new URLSearchParams()
        qs.set("business_id", business.id)
        qs.set("page", String(page))
        qs.set("limit", "50")
        const res = await fetch(`/api/proposals/list?${qs.toString()}`, { credentials: "same-origin" })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(payload.error || "Failed to load proposals")
          setRows([])
          return
        }
        if (cancelled) return
        setRows(payload.proposals || [])
        setPagination(payload.pagination || { page: 1, pageSize: 50, totalCount: 0, totalPages: 0 })
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [page])

  async function deleteProposal(id: string, title: string) {
    if (!businessId) {
      setError("Business context not ready. Refresh the page and try again.")
      return
    }
    const row = rows.find((r) => r.id === id)
    const st = normalizeProposalStatus(row?.status || "draft")
    if (!proposalCanBeEditedByStaff(st)) {
      setError("This proposal can’t be deleted in its current state.")
      return
    }
    if (!window.confirm(`Delete “${title || "Untitled"}”? This cannot be undone.`)) return
    try {
      setDeletingId(id)
      setError("")
      const qs = new URLSearchParams({ business_id: businessId as string }).toString()
      const res = await fetch(`/api/proposals/${id}?${qs}`, { method: "DELETE", credentials: "same-origin" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "Delete failed")
        return
      }
      setRows((prev) => prev.filter((r) => r.id !== id))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setDeletingId(null)
    }
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "numeric" })

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Proposals</h1>
            <p className="mt-0.5 text-sm text-slate-500">Structured proposals with a secure client link</p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/service/proposals/new")}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            New proposal
          </button>
        </div>

        {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="hidden px-4 py-3 sm:table-cell">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                    No proposals yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const st = normalizeProposalStatus(r.status) as ProposalStatus
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-medium text-slate-900">{r.title || "Untitled"}</td>
                      <td className="px-4 py-3 text-slate-600">{PROPOSAL_STATUS_LABEL[st]}</td>
                      <td className="hidden px-4 py-3 text-slate-500 sm:table-cell">{formatDate(r.updated_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {r.converted_estimate_id ? (
                            <button
                              type="button"
                              className="text-sm font-medium text-emerald-800 hover:underline"
                              onClick={() => router.push(`/service/estimates/${r.converted_estimate_id}/edit`)}
                            >
                              Quote
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="text-sm font-medium text-blue-700 hover:underline"
                            onClick={() => router.push(`/service/proposals/${r.id}/edit`)}
                          >
                            Edit
                          </button>
                          {proposalCanBeEditedByStaff(st) ? (
                            <button
                              type="button"
                              disabled={deletingId === r.id}
                              className="text-sm font-medium text-red-700 hover:underline disabled:opacity-50"
                              onClick={() => void deleteProposal(r.id, r.title || "")}
                            >
                              {deletingId === r.id ? "Deleting…" : "Delete"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {pagination.totalPages > 1 ? (
          <div className="flex items-center justify-between text-sm text-slate-600">
            <button
              type="button"
              disabled={page <= 1}
              className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span>
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              disabled={page >= pagination.totalPages}
              className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40"
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
