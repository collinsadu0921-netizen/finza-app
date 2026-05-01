"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { FinzaLogo } from "@/components/FinzaLogo"
import { getPublicAppUrl } from "@/lib/auth/publicAppUrl"

function CheckEmailInner() {
  const searchParams = useSearchParams()
  const email = searchParams.get("email") ?? ""
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [message, setMessage] = useState("")

  const resend = async () => {
    if (!email.trim()) {
      setMessage("Missing email. Return to sign up and try again.")
      setStatus("error")
      return
    }
    setStatus("sending")
    setMessage("")
    try {
      const origin = getPublicAppUrl()
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: {
          emailRedirectTo: `${origin}/auth/callback`,
        },
      })
      if (error) {
        setMessage(error.message || "Could not resend email")
        setStatus("error")
        return
      }
      setStatus("sent")
    } catch (e: any) {
      setMessage(e?.message || "Something went wrong")
      setStatus("error")
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-100 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-10 shadow-xl">
        <div className="mb-8 flex justify-center">
          <FinzaLogo height={64} />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">Check your email</h1>
        <p className="text-sm text-gray-600 text-center mb-6">
          We sent a confirmation link to <span className="font-semibold text-gray-800">{email || "your address"}</span>.
          Open the email and tap <strong>Confirm</strong> to finish creating your Finza Service account.
        </p>

        {status === "sent" && (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Another confirmation email is on its way.
          </div>
        )}
        {(status === "error" || message) && status !== "sent" && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>
        )}

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void resend()}
            disabled={status === "sending"}
            className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {status === "sending" ? "Sending…" : "Resend confirmation email"}
          </button>
          <Link
            href="/login"
            className="w-full rounded-lg border border-gray-200 py-3 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Back to sign in
          </Link>
          <Link href="/signup" className="text-center text-sm text-blue-600 font-semibold hover:text-blue-700 py-2">
            Use a different email
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function SignupCheckEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">Loading…</div>
      }
    >
      <CheckEmailInner />
    </Suspense>
  )
}
