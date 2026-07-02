"use client"

import { useState } from "react"
import Link from "next/link"
import {
  SUPPORT_REQUEST_CATEGORIES,
  MESSAGE_MIN_LENGTH,
  MESSAGE_MAX_LENGTH,
} from "@/lib/support/supportRequestValidation"

export type ContactSupportFormProps = {
  businessId: string | null
  defaultCategory?: string
  backHref?: string
}

export default function ContactSupportForm({
  businessId,
  defaultCategory = "",
  backHref = "/help",
}: ContactSupportFormProps) {
  const [category, setCategory] = useState(defaultCategory)
  const [subject, setSubject] = useState("")
  const [message, setMessage] = useState("")
  const [urgency, setUrgency] = useState<"normal" | "urgent">("normal")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!businessId) {
      setError("Select a business workspace before contacting support.")
      return
    }
    setSubmitting(true)
    setError("")
    try {
      const res = await fetch("/api/support/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          category,
          subject,
          message,
          urgency,
          route: typeof window !== "undefined" ? window.location.pathname : null,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Could not submit request")
      }
      setSuccess(true)
      setMessage("")
      setSubject("")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not submit request")
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-800 dark:bg-emerald-900/20">
        <h2 className="text-lg font-semibold text-emerald-900 dark:text-emerald-100">
          Request submitted
        </h2>
        <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-200">
          Thank you. Our team will follow up using your account email. You can keep working in Finza
          while we review your message.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href={backHref}
            className="text-sm font-medium text-emerald-700 underline dark:text-emerald-300"
          >
            Back to Help Center
          </Link>
          <button
            type="button"
            onClick={() => setSuccess(false)}
            className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400"
          >
            Send another message
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!businessId ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Open Finza from your business workspace so we know which account to help.
        </p>
      ) : null}

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Category <span className="text-red-500">*</span>
        </label>
        <select
          required
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          <option value="" disabled>
            Select a category
          </option>
          {SUPPORT_REQUEST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Subject <span className="text-slate-400">(recommended)</span>
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder="Short summary of your issue"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Message <span className="text-red-500">*</span>
        </label>
        <textarea
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          minLength={MESSAGE_MIN_LENGTH}
          maxLength={MESSAGE_MAX_LENGTH}
          rows={6}
          placeholder="Tell us what happened and what you were trying to do…"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <p className="mt-1 text-xs text-slate-400">
          At least {MESSAGE_MIN_LENGTH} characters · {message.length}/{MESSAGE_MAX_LENGTH}
        </p>
      </div>

      <div>
        <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">Urgency</span>
        <div className="mt-2 flex gap-4">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="urgency"
              checked={urgency === "normal"}
              onChange={() => setUrgency("normal")}
            />
            Normal
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="urgency"
              checked={urgency === "urgent"}
              onChange={() => setUrgency("urgent")}
            />
            Urgent
          </label>
        </div>
      </div>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <button
        type="submit"
        disabled={submitting || !businessId}
        className="inline-flex items-center justify-center rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
      >
        {submitting ? "Sending…" : "Submit to Finza Support"}
      </button>
    </form>
  )
}
