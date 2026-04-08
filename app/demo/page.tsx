"use client"

import Link from "next/link"
import { FinzaDemoVideoEmbed } from "@/components/marketing/FinzaDemoVideoEmbed"
import { resolveDemoVideoWatchUrl } from "@/lib/demoVideo"

export default function DemoPage() {
  const watchUrl = resolveDemoVideoWatchUrl()

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/login"
            className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            ← Back to sign in
          </Link>
          <h1 className="text-xl font-semibold text-gray-900">How Finza works</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          <FinzaDemoVideoEmbed
            className="rounded-none shadow-none ring-0"
            title="How Finza works — product overview"
          />
          <div className="p-6 space-y-3">
            <p className="text-gray-600 text-sm">
              See how FINZA helps you run invoicing, expenses, and more. Prefer YouTube?{" "}
              <a
                href={watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 font-semibold hover:text-blue-700"
              >
                Open on YouTube
              </a>
              .
            </p>
            <p className="text-gray-600 text-sm">
              Ready to try it yourself?{" "}
              <Link href="/signup" className="text-blue-600 font-semibold hover:text-blue-700">
                Sign up for free
              </Link>
              {" "}or{" "}
              <Link href="/login" className="text-blue-600 font-semibold hover:text-blue-700">
                sign in
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
