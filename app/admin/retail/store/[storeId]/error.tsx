"use client"

import { useEffect } from "react"
import Link from "next/link"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Store page error:", error)
  }, [error])

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
        <h2 className="text-xl font-semibold mb-2">Something went wrong!</h2>
        <p className="mb-2">{error.message || "An error occurred while loading the store page."}</p>
        {error.digest && (
          <p className="text-sm text-red-600">Error ID: {error.digest}</p>
        )}
      </div>
      <div className="flex gap-4">
        <button
          onClick={reset}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Try again
        </button>
        <Link
          href="/admin/retail/stores"
          className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
        >
          ← Back to Stores
        </Link>
      </div>
    </div>
  )
}



