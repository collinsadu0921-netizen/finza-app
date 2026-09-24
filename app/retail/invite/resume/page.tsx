"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { setSelectedBusinessId } from "@/lib/business"
import { RETAIL_INVITE_RESUME_PATH } from "@/lib/retail/invitations/retailInvitationToken"

type Pending =
  | {
      state: "ready"
      invitationId: string
      businessName: string
      signedInUserId: string
      signedInEmailMasked: string | null
      pendingCount: number
    }
  | { state: "none"; signedInUserId?: string; signedInEmailMasked?: string | null }
  | { state: "signed_out" }

export default function ResumeRetailInvitationPage() {
  const router = useRouter()
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetch("/api/retail/invitations/pending", { credentials: "same-origin" })
      .then(async (res) => {
        if (res.status === 401) return { state: "signed_out" as const }
        return (await res.json()) as Pending
      })
      .then((json) => {
        if (!cancelled) setPending(json)
      })
      .catch(() => {
        if (!cancelled) setPending({ state: "none" })
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function accept(invitationId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invitationId)) {
      setError("This invitation could not be accepted.")
      return
    }
    setWorking(true)
    setError(null)
    const res = await fetch("/api/retail/invitations/accept", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invitationId }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(json.error || "This invitation could not be accepted.")
      setWorking(false)
      return
    }
    if (json.businessId) setSelectedBusinessId(String(json.businessId))
    router.replace("/onboarding/retail")
  }

  const canAccept = pending?.state === "ready" && !working

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold text-slate-900">Retail invitation</h1>
      {!pending && <p className="mt-3 text-sm text-slate-600">Checking your invitation…</p>}
      {pending?.state === "signed_out" && (
        <p className="mt-3 text-sm">
          <Link className="underline" href={`/login?next=${encodeURIComponent(RETAIL_INVITE_RESUME_PATH)}`}>
            Sign in
          </Link>{" "}
          with the invited email to continue.
        </p>
      )}
      {pending?.state === "none" && (
        <div className="mt-3 space-y-2 text-sm">
          <p>No pending Retail invitation was found for this account.</p>
          {pending.signedInEmailMasked && (
            <p className="text-slate-600">
              Signed in as <strong>{pending.signedInEmailMasked}</strong>.
            </p>
          )}
        </div>
      )}
      {pending?.state === "ready" && (
        <div className="mt-4 space-y-3 text-sm">
          <p>
            Confirm to create the Retail business <strong>{pending.businessName}</strong>. This does not create a Service
            business.
          </p>
          {pending.signedInEmailMasked && (
            <p className="text-slate-600">
              Signed in as <strong>{pending.signedInEmailMasked}</strong>.
            </p>
          )}
          {error && <p className="text-red-700">{error}</p>}
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
            disabled={!canAccept}
            onClick={() => void accept(pending.invitationId)}
          >
            {working ? "Creating…" : "Create Retail business"}
          </button>
        </div>
      )}
    </div>
  )
}
