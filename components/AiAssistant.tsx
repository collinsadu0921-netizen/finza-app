"use client"

import { FormEvent, useEffect, useRef, useState } from "react"

type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

type AiAssistantProps = {
  context?: unknown
}

export default function AiAssistant({ context }: AiAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [isOpen, setIsOpen] = useState(true)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, loading])

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    setLoading(true)
    setError("")
    setInput("")

    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ])

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          context,
        }),
      })

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
    } catch (err: any) {
      setError(err?.message || "Failed to get AI response")
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
        onClick={() => setIsOpen(true)}
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
            <p className="text-[11px] text-blue-100">Online</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="rounded-md px-2 py-1 text-xs font-semibold bg-white/15 hover:bg-white/25"
          aria-label="Minimize Finza Assist"
        >
          Minimize
        </button>
      </header>

      <div
        ref={messagesContainerRef}
        className="h-80 overflow-y-auto space-y-3 bg-slate-50/70 dark:bg-slate-900/40 px-3 py-3"
      >
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center px-3">
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
              Ask Finza Assist about invoices, bills, tax, reports, payroll, and where to go in the app.
            </p>
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
                : (loading && m.role === "assistant" ? "..." : "")}
            </div>
          ))
        )}
      </div>

      {error && (
        <p className="px-3 pt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <form onSubmit={sendMessage} className="border-t border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 p-3 flex gap-2">
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
          disabled={loading || !input.trim()}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
        >
          {loading ? "..." : "Send"}
        </button>
      </form>
    </section>
  )
}

