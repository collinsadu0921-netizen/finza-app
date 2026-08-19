"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { FinzaLogo } from "@/components/FinzaLogo"
import { buildOAuthRedirectToWithMarketingContext, signInWithGoogle } from "@/lib/auth/startGoogleAuth"
import { INVITATION_SESSION_KEY } from "@/lib/accounting/firm/staffInvitations"

type Preview = {
  firm_name: string
  role: string
  role_label: string
  email: string
  expires_at: string
}

function persistInvitationToken(token: string) {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(INVITATION_SESSION_KEY, token)
  }
}

function readInvitationTokenFromSession(): string | null {
  if (typeof window === "undefined") return null
  return sessionStorage.getItem(INVITATION_SESSION_KEY)
}

function AcceptInvitationInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tokenParam = searchParams.get("token")?.trim() ?? ""
  const [token, setToken] = useState(tokenParam)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState("")
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    const effective = tokenParam || readInvitationTokenFromSession() || ""
    if (effective) {
      setToken(effective)
      persistInvitationToken(effective)
    }
  }, [tokenParam])

  useEffect(() => {
    const load = async () => {
      if (!token) {
        setError("Invitation link is invalid or missing.")
        setLoading(false)
        return
      }

      try {
        const res = await fetch(
          `/api/accounting/firm/staff/invitations/preview?token=${encodeURIComponent(token)}`
        )
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || "Invitation is not available.")
          setLoading(false)
          return
        }
        setPreview(data)

        const { data: sessionData } = await supabase.auth.getSession()
        setSignedIn(!!sessionData.session?.user)
      } catch {
        setError("Failed to load invitation.")
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [token])

  const acceptInvitation = useCallback(async () => {
    if (!token) return
    setAccepting(true)
    setError("")
    try {
      const res = await fetch("/api/accounting/firm/staff/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Could not accept invitation.")
        return
      }
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(INVITATION_SESSION_KEY)
      }
      router.replace(data.redirect || "/accounting/dashboard")
    } catch {
      setError("Could not accept invitation.")
    } finally {
      setAccepting(false)
    }
  }, [token, router])

  useEffect(() => {
    if (signedIn && preview && token && !accepting && !error) {
      void acceptInvitation()
    }
  }, [signedIn, preview, token, accepting, error, acceptInvitation])

  const loginHref = `/login?invitation_token=${encodeURIComponent(token)}`
  const signupHref = `/signup?invitation_token=${encodeURIComponent(token)}&workspace=practice`

  const handleGoogle = async () => {
    persistInvitationToken(token)
    const redirectTo = buildOAuthRedirectToWithMarketingContext({
      workspace: "practice",
      invitation_token: token,
    })
    await signInWithGoogle(redirectTo)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading invitation…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <FinzaLogo className="h-8" />
      </div>
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        {error && !preview ? (
          <>
            <h1 className="text-xl font-semibold text-gray-900">Invitation unavailable</h1>
            <p className="mt-3 text-sm text-gray-600">{error}</p>
            <Link href="/login" className="mt-6 inline-block text-sm text-blue-600 hover:underline">
              Go to sign in
            </Link>
          </>
        ) : preview ? (
          <>
            <p className="text-sm font-medium text-gray-500">Finza Practice</p>
            <h1 className="mt-1 text-2xl font-semibold text-gray-900">You&apos;ve been invited</h1>
            <p className="mt-4 text-sm text-gray-600">
              Join <strong>{preview.firm_name}</strong> on Finza Practice.
            </p>
            <p className="mt-2 text-sm text-gray-600">
              Role: <strong>{preview.role_label}</strong>
            </p>
            <p className="mt-2 text-xs text-gray-500">Sent to {preview.email}</p>

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

            {signedIn ? (
              <button
                type="button"
                onClick={() => void acceptInvitation()}
                disabled={accepting}
                className="mt-6 w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {accepting ? "Accepting…" : "Accept invitation"}
              </button>
            ) : (
              <div className="mt-6 space-y-3">
                <Link
                  href={loginHref}
                  className="block w-full rounded-lg bg-gray-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-gray-800"
                >
                  Sign in
                </Link>
                <Link
                  href={signupHref}
                  className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-center text-sm font-medium text-gray-900 hover:bg-gray-50"
                >
                  Create account
                </Link>
                <button
                  type="button"
                  onClick={() => void handleGoogle()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-900 hover:bg-gray-50"
                >
                  Continue with Google
                </button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}

export default function AcceptInvitationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <p className="text-sm text-gray-500">Loading…</p>
        </div>
      }
    >
      <AcceptInvitationInner />
    </Suspense>
  )
}
