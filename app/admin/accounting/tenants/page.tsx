"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import ProtectedLayout from "@/components/ProtectedLayout"
import Modal from "@/components/ui/Modal"
import Button from "@/components/ui/Button"

type Tenant = {
  id: string
  name: string | null
  owner_id: string | null
  created_at: string
  archived_at: string | null
}

const PAGE_SIZE = 20
const MIN_REACTIVATE_REASON = 10

export default function AdminTenantsPage() {
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [error, setError] = useState("")

  const [archiveModal, setArchiveModal] = useState<{ tenant: Tenant } | null>(null)
  const [archiveReason, setArchiveReason] = useState("")
  const [archiveSubmitting, setArchiveSubmitting] = useState(false)
  const [archiveError, setArchiveError] = useState("")

  const [reactivateModal, setReactivateModal] = useState<{ tenant: Tenant } | null>(null)
  const [reactivateReason, setReactivateReason] = useState("")
  const [reactivateSubmitting, setReactivateSubmitting] = useState(false)
  const [reactivateError, setReactivateError] = useState("")

  useEffect(() => {
    loadTenants()
  }, [page, search])

  const loadTenants = async () => {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("page_size", String(PAGE_SIZE))
      if (search) params.set("search", search)
      const res = await fetch(`/api/admin/accounting/tenants?${params.toString()}`)
      if (res.status === 403) {
        setForbidden(true)
        setTenants([])
        setTotal(0)
        setLoading(false)
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setTenants(data.tenants ?? [])
      setTotal(data.total ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tenants")
      setTenants([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  const handleArchive = async () => {
    const tenant = archiveModal?.tenant
    if (!tenant) return
    setArchiveSubmitting(true)
    setArchiveError("")
    try {
      const res = await fetch(`/api/admin/accounting/tenants/${tenant.id}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: archiveReason.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Archive failed")
      setArchiveModal(null)
      setArchiveReason("")
      loadTenants()
    } catch (e) {
      setArchiveError(e instanceof Error ? e.message : "Archive failed")
    } finally {
      setArchiveSubmitting(false)
    }
  }

  const handleReactivate = async () => {
    const tenant = reactivateModal?.tenant
    if (!tenant) return
    const reason = reactivateReason.trim()
    if (reason.length < MIN_REACTIVATE_REASON) {
      setReactivateError(`Reason must be at least ${MIN_REACTIVATE_REASON} characters`)
      return
    }
    setReactivateSubmitting(true)
    setReactivateError("")
    try {
      const res = await fetch(`/api/admin/accounting/tenants/${tenant.id}/reactivate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Reactivate failed")
      setReactivateModal(null)
      setReactivateReason("")
      loadTenants()
    } catch (e) {
      setReactivateError(e instanceof Error ? e.message : "Reactivate failed")
    } finally {
      setReactivateSubmitting(false)
    }
  }

  const formatDate = (s: string | null) =>
    s ? new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—"

  if (forbidden) {
    return (
      <ProtectedLayout>
        <div className="p-6 max-w-2xl">
          <p className="text-red-600 dark:text-red-400">
            You don’t have access to tenant management. Only Owner, Firm Admin, or Accounting Admin can view this page.
          </p>
          <Link
            href="/accounting"
            className="mt-4 inline-block text-blue-600 dark:text-blue-400 hover:underline"
          >
            Back to Accounting
          </Link>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
              Tenant safety (archive / reactivate)
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Archive or reactivate tenants. Archived tenants are excluded from forensic monitoring.
            </p>
          </div>
          <Link
            href="/accounting"
            className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
          >
            ← Accounting
          </Link>
        </div>

        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 mb-6 text-amber-800 dark:text-amber-200 text-sm">
          Archived tenants are excluded from forensic monitoring.
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-4">
          <input
            type="text"
            placeholder="Search by name or ID"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setSearch(searchInput.trim())}
            className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-800 dark:text-white w-64"
          />
          <button
            type="button"
            onClick={() => setSearch(searchInput.trim())}
            className="px-3 py-2 rounded border border-gray-300 dark:border-gray-600 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Search
          </button>
        </div>

        {loading ? (
          <p className="text-gray-500 dark:text-gray-400">Loading tenants…</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      business_id
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      owner_id
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      created_at
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      archived_at
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {tenants.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                        No tenants found.
                      </td>
                    </tr>
                  ) : (
                    tenants.map((tenant) => (
                      <tr key={tenant.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                          {tenant.name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-400 truncate max-w-[200px]">
                          {tenant.id}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-400 truncate max-w-[200px]">
                          {tenant.owner_id ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {formatDate(tenant.created_at)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {formatDate(tenant.archived_at)}
                        </td>
                        <td className="px-4 py-3">
                          {tenant.archived_at ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200">
                              Archived
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {tenant.archived_at ? (
                            <button
                              type="button"
                              onClick={() => {
                                setReactivateModal({ tenant })
                                setReactivateReason("")
                                setReactivateError("")
                              }}
                              className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              Reactivate
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setArchiveModal({ tenant })
                                setArchiveReason("")
                                setArchiveError("")
                              }}
                              className="text-sm font-medium text-amber-600 dark:text-amber-400 hover:underline"
                            >
                              Archive
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {total > PAGE_SIZE && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Page {page} of {Math.ceil(total / PAGE_SIZE)} ({total} tenants)
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50 text-sm"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= Math.ceil(total / PAGE_SIZE)}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-3 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50 text-sm"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Archive confirm modal */}
        <Modal
          isOpen={!!archiveModal}
          onClose={() => !archiveSubmitting && setArchiveModal(null)}
          title="Archive tenant"
          size="md"
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setArchiveModal(null)}
                disabled={archiveSubmitting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleArchive}
                isLoading={archiveSubmitting}
                disabled={archiveSubmitting}
              >
                Archive tenant
              </Button>
            </>
          }
        >
          {archiveModal && (
            <div className="space-y-4">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                You are about to archive <strong>{archiveModal.tenant.name ?? archiveModal.tenant.id}</strong>.
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                This will set archived_at and exclude the tenant from forensic monitoring. Data is retained; the tenant can be reactivated later.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Reason (optional)
                </label>
                <textarea
                  value={archiveReason}
                  onChange={(e) => setArchiveReason(e.target.value)}
                  placeholder="e.g. Excluding from monitoring for focus."
                  rows={2}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-white"
                />
              </div>
              {archiveError && (
                <p className="text-sm text-red-600 dark:text-red-400">{archiveError}</p>
              )}
            </div>
          )}
        </Modal>

        {/* Reactivate confirm modal */}
        <Modal
          isOpen={!!reactivateModal}
          onClose={() => !reactivateSubmitting && setReactivateModal(null)}
          title="Reactivate tenant"
          size="md"
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setReactivateModal(null)}
                disabled={reactivateSubmitting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleReactivate}
                isLoading={reactivateSubmitting}
                disabled={reactivateSubmitting || reactivateReason.trim().length < MIN_REACTIVATE_REASON}
              >
                Reactivate tenant
              </Button>
            </>
          }
        >
          {reactivateModal && (
            <div className="space-y-4">
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                You are about to reactivate <strong>{reactivateModal.tenant.name ?? reactivateModal.tenant.id}</strong>.
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                This will clear archived_at. The tenant will be included in forensic monitoring again.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Reason <span className="text-red-500">*</span> (min {MIN_REACTIVATE_REASON} characters)
                </label>
                <textarea
                  value={reactivateReason}
                  onChange={(e) => setReactivateReason(e.target.value)}
                  placeholder="e.g. Resuming monitoring for this client."
                  rows={3}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-white"
                />
                <p className="text-xs text-gray-500 mt-0.5">
                  {reactivateReason.trim().length} / {MIN_REACTIVATE_REASON} characters
                </p>
              </div>
              {reactivateError && (
                <p className="text-sm text-red-600 dark:text-red-400">{reactivateError}</p>
              )}
            </div>
          )}
        </Modal>
      </div>
    </ProtectedLayout>
  )
}
