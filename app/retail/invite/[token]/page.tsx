"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { setSelectedBusinessId } from "@/lib/business"
import {
  isPlausibleRetailInviteToken,
  RETAIL_INVITE_RESUME_PATH,
  RETAIL_INVITE_RESUME_SEGMENT,
} from "@/lib/retail/invitations/retailInvitationToken"

type Preview =
  | {
      state: "ready"
      businessName: string | null
      emailMatches: boolean | null
      signedInUserId: string | null
      signedInEmailMasked: string | null
    }
  | {
      state: "expired" | "revoked" | "accepted" | "invalid"
      signedInUserId?: string | null
      signedInEmailMasked?: string | null
    }

export default function RetailInvitePage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const rawToken = typeof params.token === "string" ? params.token : ""
  const token = rawToken === RETAIL_INVITE_RESUME_SEGMENT ? "" : rawToken
  const nextPath = isPlausibleRetailInviteToken(token)
    ? `/retail/invite/${encodeURIComponent(token)}`
    : RETAIL_INVITE_RESUME_PATH
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (rawToken === RETAIL_INVITE_RESUME_SEGMENT) {
      router.replace(RETAIL_INVITE_RESUME_PATH)
      return
    }
    if (!isPlausibleRetailInviteToken(token)) {
      setPreview({ state: "invalid" })
      return
    }
    let cancelled = false
    void fetch(`/api/retail/invitations/preview?token=${encodeURIComponent(token)}`, {
      credentials: "same-origin",
    })
      .then((res) => res.json())
      .then((json: Preview) => {
        if (!cancelled) setPreview(json)
      })
      .catch(() => {
        if (!cancelled) setPreview({ state: "invalid" })
      })
    return () => {
      cancelled = true
    }
  }, [rawToken, token, router])

  async function accept() {
    if (!isPlausibleRetailInviteToken(token) || preview?.state !== "ready" || preview.emailMatches !== true) {
      return
    }
    setWorking(true)
    setError(null)
    const res = await fetch("/api/retail/invitations/accept", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
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

  const canAccept = preview?.state === "ready" && preview.emailMatches === true && !working

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold text-slate-900">Retail invitation</h1>
      {!preview && <p className="mt-3 text-sm text-slate-600">Checking this link…</p>}
      {preview?.state === "invalid" && <p className="mt-3 text-sm">This invitation link is not valid.</p>}
      {preview?.state === "expired" && <p className="mt-3 text-sm">This invitation has expired.</p>}
      {preview?.state === "revoked" && (
        <p className="mt-3 text-sm">
          This invitation link was replaced.{" "}
          <Link className="underline" href={RETAIL_INVITE_RESUME_PATH}>
            Continue with the current invitation
          </Link>
          .
        </p>
      )}
      {preview?.state === "accepted" && <p className="mt-3 text-sm">This invitation has already been used.</p>}
      {preview?.state === "ready" && preview.emailMatches == null && (
        <div className="mt-4 space-y-3 text-sm">
          <p>This Retail invitation can continue. Sign in or create an account with the invited email address.</p>
          <div className="flex gap-3">
            <Link className="rounded-md bg-slate-900 px-3 py-2 text-white" href={`/login?next=${encodeURIComponent(nextPath)}`}>
              Sign in
            </Link>
            <Link className="rounded-md border px-3 py-2" href={`/signup?next=${encodeURIComponent(nextPath)}`}>
              Create account
            </Link>
          </div>
        </div>
      )}
      {preview?.state === "ready" && preview.emailMatches === false && (
        <div className="mt-3 space-y-2 text-sm">
          <p>This signed-in account does not match the invitation.</p>
          {preview.signedInEmailMasked && (
            <p className="text-slate-600">
              Signed in as <strong>{preview.signedInEmailMasked}</strong>. Sign out and use the invited email address.
            </p>
          )}
          <Link className="inline-block underline" href={`/login?next=${encodeURIComponent(nextPath)}`}>
            Switch account
          </Link>
        </div>
      )}
      {preview?.state === "ready" && preview.emailMatches === true && (
        <div className="mt-4 space-y-3 text-sm">
          <p>
            Confirm to create the Retail business <strong>{preview.businessName}</strong>. This does not change any other
            Finza business you already use.
          </p>
          {error && <p className="text-red-700">{error}</p>}
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
            disabled={!canAccept}
            onClick={() => void accept()}
          >
            {working ? "Creating…" : "Create Retail business"}
          </button>
        </div>
      )}
    </div>
  )
}
