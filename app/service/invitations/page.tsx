"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"

type PendingItem = {
  id: string
  accounting_firm_id: string
  firm_name: string
  firm_contact_email?: string | null
  access_level: string
  effective_from: string
  effective_to: string | null
  created_at: string
}

type ActiveItem = {
  id: string
  accounting_firm_id: string
  firm_name: string
  firm_contact_email?: string | null
  access_level: string
  effective_from: string
  effective_to: string | null
  accepted_at: string | null
}

export default function ServiceInvitationsPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [noContext, setNoContext] = useState(false)
  const [pending, setPending] = useState<PendingItem[]>([])
  const [active, setActive] = useState<ActiveItem[]>([])
  const [ownerError, setOwnerError] = useState<string | null>(null)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({})
  const [rejectModal, setRejectModal] = useState<{ id: string; firmName: string } | null>(null)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    setLoading(true)
    setOwnerError(null)
    setCardErrors({})
    try {
      const res = await fetch("/api/service/invitations")
      const data = await res.json()
      if (res.status === 401) {
        router.push("/login")
        return
      }
      if (!res.ok) {
        setLoading(false)
        return
      }
      if (!data.businessId) {
        setNoContext(true)
        setPending([])
        setActive([])
        setLoading(false)
        return
      }
      setPending(data.pending ?? [])
      setActive(data.active ?? [])
      setLoading(false)
    } catch (err) {
      setLoading(false)
      toast.showToast("Failed to load invitations", "error")
    }
  }

  const handleAccept = async (id: string) => {
    setActioningId(id)
    setCardErrors((e) => ({ ...e, [id]: "" }))
    try {
      const res = await fetch(`/api/service/engagements/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      })
      const data = await res.json()
      if (res.status === 403 && (data.error || "").includes("business owners")) {
        setOwnerError(data.error || "Only business owners can respond.")
        setActioningId(null)
        return
      }
      if (!res.ok) {
        setCardErrors((e) => ({ ...e, [id]: data.error || "Failed to accept" }))
        setActioningId(null)
        return
      }
      toast.showToast("Invitation accepted.", "success")
      await load()
    } catch {
      setCardErrors((e) => ({ ...e, [id]: "Request failed" }))
    } finally {
      setActioningId(null)
    }
  }

  const handleRejectClick = (id: string, firmName: string) => {
    setRejectModal({ id, firmName })
  }

  const handleRejectConfirm = async () => {
    if (!rejectModal) return
    const id = rejectModal.id
    setRejectModal(null)
    setActioningId(id)
    setCardErrors((e) => ({ ...e, [id]: "" }))
    try {
      const res = await fetch(`/api/service/engagements/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      })
      const data = await res.json()
      if (res.status === 403 && (data.error || "").includes("business owners")) {
        setOwnerError(data.error || "Only business owners can respond.")
        setActioningId(null)
        return
      }
      if (!res.ok) {
        setCardErrors((e) => ({ ...e, [id]: data.error || "Failed to reject" }))
        setActioningId(null)
        return
      }
      toast.showToast("Invitation rejected.", "success")
      await load()
    } catch {
      setCardErrors((e) => ({ ...e, [id]: "Request failed" }))
    } finally {
      setActioningId(null)
    }
  }

  const accessLevelLabel = (level: string) => {
    switch (level) {
      case "approve":
        return "Approve"
      case "write":
        return "Write"
      case "read":
        return "Read"
      default:
        return level
    }
  }

  const formatDate = (s: string) => {
    try {
      return new Date(s).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    } catch {
      return s
    }
  }

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <header className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Accountant Requests
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Approve firms here to allow them to manage your accounting.
            </p>
          </header>

          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          )}

          {noContext && !loading && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
              <p className="text-gray-600 dark:text-gray-300">
                No business context.
              </p>
            </div>
          )}

          {!loading && !noContext && (
            <>
              {ownerError && (
                <div className="mb-6 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-amber-800 dark:text-amber-200 text-sm">
                  {ownerError}
                </div>
              )}

              {/* Pending Invitations */}
              <section className="mb-10">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Pending Invitations
                </h2>
                {pending.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No pending requests.
                  </p>
                ) : (
                  <ul className="space-y-4">
                    {pending.map((item) => (
                      <li
                        key={item.id}
                        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm"
                      >
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {item.firm_name}
                        </div>
                        {item.firm_contact_email && (
                          <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                            {item.firm_contact_email}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                            {accessLevelLabel(item.access_level)}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            Effective from {formatDate(item.effective_from)}
                            {item.effective_to ? ` to ${formatDate(item.effective_to)}` : ""}
                          </span>
                        </div>
                        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                          This firm will be able to view and manage your accounting data according to the access level above.
                        </p>
                        {cardErrors[item.id] && (
                          <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                            {cardErrors[item.id]}
                          </p>
                        )}
                        <div className="mt-4 flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => handleAccept(item.id)}
                            disabled={!!actioningId}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
                          >
                            {actioningId === item.id ? "Accepting…" : "Accept"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectClick(item.id, item.firm_name)}
                            disabled={!!actioningId}
                            className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white text-sm font-medium disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Active Accountants */}
              <section>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Active Accountants
                </h2>
                {active.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No active accountants.
                  </p>
                ) : (
                  <ul className="space-y-4">
                    {active.map((item) => (
                      <li
                        key={item.id}
                        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm"
                      >
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {item.firm_name}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                            {accessLevelLabel(item.access_level)}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {item.accepted_at
                              ? `Active since ${formatDate(item.accepted_at)}`
                              : "Active"}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {/* Reject confirmation modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Reject invitation?
            </h3>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              You are about to reject the request from <strong>{rejectModal.firmName}</strong>. They will not have access to your accounting records.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRejectModal(null)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRejectConfirm}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
