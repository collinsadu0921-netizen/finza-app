"use client"

import { useMemo, useState } from "react"

type Props = {
  step: string
}

export default function OnboardingAIAssistant({ step }: Props) {
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const quickPrompts = useMemo(
    () => [
      "Explain this step in simple terms",
      "What should I fill first to finish this quickly?",
      "What mistakes should I avoid on this step?",
    ],
    []
  )

  const ask = async (q?: string) => {
    const prompt = (q ?? question).trim()
    if (!prompt) return

    setLoading(true)
    setError("")
    setAnswer("")

    try {
      const response = await fetch("/api/onboarding/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: prompt,
          step,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data?.error || "Failed to get AI response")
        return
      }
      setAnswer(String(data?.answer || ""))
    } catch (err: any) {
      setError(err?.message || "Failed to get AI response")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
          <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3a3.75 3.75 0 00-3.75 3.75v2.057a7.5 7.5 0 00-2.25 5.31V15a6 6 0 006 6h4.5a6 6 0 006-6v-.883a7.5 7.5 0 00-2.25-5.31V6.75A3.75 3.75 0 0014.75 3h-5z" />
          </svg>
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">AI Onboarding Assistant</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">Ask for guided help on this step</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {quickPrompts.map((prompt) => (
          <button
            key={prompt}
            onClick={() => {
              setQuestion(prompt)
              void ask(prompt)
            }}
            disabled={loading}
            className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
          >
            {prompt}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything about this onboarding step..."
          rows={3}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        />
        <button
          onClick={() => void ask()}
          disabled={loading || !question.trim()}
          className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Thinking..." : "Ask AI"}
        </button>
      </div>

      {error && (
        <div className="mt-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-2.5">
          {error}
        </div>
      )}

      {answer && (
        <div className="mt-3 text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3 whitespace-pre-wrap">
          {answer}
        </div>
      )}
    </div>
  )
}

