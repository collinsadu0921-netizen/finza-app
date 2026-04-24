"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabaseClient"

function businessIdFromContext(context: unknown): string | null {
  if (!context || typeof context !== "object") return null
  const id = (context as Record<string, unknown>).business_id
  return typeof id === "string" && id.trim() ? id.trim() : null
}

type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

type AiAssistantProps = {
  context?: unknown
  /** Refetch client-side AI context when the user opens the panel (e.g. fresher snapshot). */
  onPanelOpen?: () => void
}

const AI_FETCH_TIMEOUT_MS = 180_000

const SUGGESTED_PROMPTS = [
  "What are my totals this month?",
  "Summarize my profit and loss for the current period",
  "Who owes me? List overdue invoices",
  "How do I create an invoice?",
  "Explain VAT flat rate vs standard",
  "Where is payroll?",
]

export default function AiAssistant({ context, onPanelOpen }: AiAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptUploading, setReceiptUploading] = useState(false)
  /** Shown in the assistant bubble while waiting (OCR + LLM can take 30–90s). */
  const [loadHint, setLoadHint] = useState("")
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, loading])

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) onPanelOpen?.()
    wasOpenRef.current = isOpen
  }, [isOpen, onPanelOpen])

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if ((!text && !receiptFile) || loading) return

    const businessId = businessIdFromContext(context)
    let receiptPath: string | undefined

    if (receiptFile) {
      if (!businessId) {
        setError("Receipt scan needs a loaded workspace. Wait for the page to finish loading, then try again.")
        return
      }
      const canScan =
        receiptFile.type.startsWith("image/") || receiptFile.type === "application/pdf"
      if (!canScan) {
        setError("Attach a receipt image (JPG, PNG, WebP) or a PDF.")
        return
      }
    }

    setLoading(true)
    setLoadHint("")
    setError("")
    setInput("")

    const userDisplay =
      text ||
      (receiptFile ? `[Receipt image: ${receiptFile.name}]` : "")

    setMessages((prev) => [
      ...prev,
      { role: "user", content: userDisplay },
      { role: "assistant", content: "" },
    ])

    try {
      if (receiptFile && businessId) {
        setLoadHint("Uploading receipt…")
        setReceiptUploading(true)
        try {
          const ext = receiptFile.name.split(".").pop() || "jpg"
          const filePath = `expenses/${businessId}/${Date.now()}.${ext}`
          const { error: upErr } = await supabase.storage.from("receipts").upload(filePath, receiptFile)
          if (upErr) {
            throw new Error(upErr.message || "Could not upload receipt for scanning")
          }
          receiptPath = filePath
          setReceiptFile(null)
          if (fileInputRef.current) fileInputRef.current.value = ""
        } finally {
          setReceiptUploading(false)
        }
      }

      setLoadHint(
        receiptPath
          ? "Reading receipt & contacting AI… (first scan can take 30–90s)"
          : "Contacting AI…"
      )

      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), AI_FETCH_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          signal: controller.signal,
          body: JSON.stringify({
            message: text || undefined,
            context,
            ...(receiptPath ? { receipt_path: receiptPath, document_type: "expense" } : {}),
          }),
        })
      } finally {
        window.clearTimeout(timeoutId)
      }

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data?.error || "Failed to get AI response")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let assistantText = ""

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        assistantText += decoder.decode(value, { stream: true })

        setMessages((prev) => {
          const next = [...prev]
          const lastIndex = next.length - 1
          if (lastIndex >= 0 && next[lastIndex].role === "assistant") {
            next[lastIndex] = { ...next[lastIndex], content: assistantText }
          }
          return next
        })
      }

      if (!assistantText.trim()) {
        setMessages((prev) => {
          const next = [...prev]
          const lastIndex = next.length - 1
          if (lastIndex >= 0 && next[lastIndex].role === "assistant") {
            next[lastIndex] = {
              ...next[lastIndex],
              content:
                "No text came back from the AI. If you use Ollama locally, ensure it is running (e.g. ollama serve), set AI_BASE_URL and AI_MODEL in .env.local, and try a shorter question. For receipt scans, try RECEIPT_OCR_USE_STUB=true in .env.local to rule out OCR delays.",
            }
          }
          return next
        })
      }
    } catch (err: any) {
      const msg =
        err?.name === "AbortError"
          ? `Request timed out after ${Math.round(AI_FETCH_TIMEOUT_MS / 1000)}s. Receipt OCR plus the language model can be slow — try a smaller/clearer image, or set RECEIPT_OCR_USE_STUB=true for local dev. Confirm your AI backend is running.`
          : err?.message || "Failed to get AI response"
      setError(msg)
      setMessages((prev) => {
        if (prev.length === 0) return prev
        const next = [...prev]
        const lastIndex = next.length - 1
        if (lastIndex >= 0 && next[lastIndex].role === "assistant" && !next[lastIndex].content) {
          next.pop()
        }
        return next
      })
    } finally {
      setLoading(false)
      setLoadHint("")
    }
  }

  const renderWithLinks = (text: string) => {
    const pathRegex = /\/[a-zA-Z0-9/_-]*/g
    const parts: Array<{ type: "text" | "link"; value: string }> = []
    let lastIndex = 0

    for (const match of text.matchAll(pathRegex)) {
      const index = match.index ?? 0
      const value = match[0]
      if (!value || value.length <= 1) continue

      if (index > lastIndex) {
        parts.push({ type: "text", value: text.slice(lastIndex, index) })
      }
      parts.push({ type: "link", value })
      lastIndex = index + value.length
    }

    if (lastIndex < text.length) {
      parts.push({ type: "text", value: text.slice(lastIndex) })
    }

    if (parts.length === 0) {
      return text
    }

    return parts.map((part, idx) => {
      if (part.type === "link") {
        return (
          <a
            key={`link-${idx}`}
            href={part.value}
            className="underline font-medium"
          >
            {part.value}
          </a>
        )
      }
      return <span key={`text-${idx}`}>{part.value}</span>
    })
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => {
          setIsOpen(true)
        }}
        className="group flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-2xl hover:from-blue-700 hover:to-indigo-700"
        aria-label="Open Finza Assist"
      >
        <span className="text-xs font-bold">FA</span>
      </button>
    )
  }

  return (
    <section className="w-[min(420px,calc(100vw-1.5rem))] rounded-2xl border border-slate-200/80 dark:border-slate-700/70 bg-white/95 dark:bg-slate-900/95 shadow-2xl backdrop-blur-sm overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-700/80 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-sm font-bold">
            FA
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Finza Assist</p>
            <p className="text-[11px] text-blue-100">Read-only · won&apos;t change your books</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="rounded-md px-2 py-1 text-xs font-semibold bg-white/15 hover:bg-white/25"
          aria-label="Minimize Finza Assist"
        >
          −
        </button>
      </header>

      <div
        ref={messagesContainerRef}
        className="h-80 overflow-y-auto space-y-3 bg-slate-50/70 dark:bg-slate-900/40 px-3 py-3"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col justify-center gap-3 px-2 py-2">
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
              Ask anything, or try a suggestion. Attach a receipt image to extract amounts (same OCR as expenses). Live
              figures use secure read-only tools on the server.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setInput(p)
                  }}
                  className="text-left text-[11px] px-2.5 py-1.5 rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 max-w-[100%]"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, idx) => (
            <div
              key={`${m.role}-${idx}`}
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === "user"
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white ml-auto"
                  : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/70 dark:border-slate-700/70 mr-auto"
              }`}
            >
              {m.content
                ? renderWithLinks(m.content)
                : loading && m.role === "assistant"
                  ? loadHint || "…"
                  : ""}
            </div>
          ))
        )}
      </div>

      {error && (
        <p className="px-3 pt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <form onSubmit={sendMessage} className="border-t border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 p-3 space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            setReceiptFile(f)
            setError("")
          }}
        />
        {receiptFile && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300">
            <span className="truncate">Receipt: {receiptFile.name}</span>
            <button
              type="button"
              className="shrink-0 font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-100"
              onClick={() => {
                setReceiptFile(null)
                if (fileInputRef.current) fileInputRef.current.value = ""
              }}
            >
              Remove
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            title="Attach receipt image for OCR"
          >
            Receipt
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Finza Assist..."
            className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || (!input.trim() && !receiptFile) || receiptUploading}
            className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
          >
            {loading || receiptUploading ? "..." : "Send"}
          </button>
        </div>
      </form>
    </section>
  )
}

