"use client"

import Link from "next/link"

const DEMO_VIDEO_URL = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL || ""

export default function DemoPage() {
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
          <h1 className="text-xl font-semibold text-gray-900">FINZA demo</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          {DEMO_VIDEO_URL ? (
            <div className="aspect-video w-full bg-black">
              <iframe
                src={
                  DEMO_VIDEO_URL.includes("youtube.com/watch")
                    ? DEMO_VIDEO_URL.replace("youtube.com/watch?v=", "youtube.com/embed/")
                    : DEMO_VIDEO_URL.includes("youtu.be/")
                      ? "https://www.youtube.com/embed/" + DEMO_VIDEO_URL.split("youtu.be/")[1]?.split("?")[0]
                      : DEMO_VIDEO_URL
                }
                title="FINZA product demo"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            </div>
          ) : (
            <div className="aspect-video w-full bg-gray-100 flex flex-col items-center justify-center text-gray-500 p-8 text-center">
              <p className="text-lg font-medium mb-2">Demo video coming soon</p>
              <p className="text-sm max-w-md">
                Add your YouTube, Loom, or Vimeo URL in <code className="bg-gray-200 px-1 rounded">NEXT_PUBLIC_DEMO_VIDEO_URL</code> to embed it here.
              </p>
            </div>
          )}
          <div className="p-6">
            <p className="text-gray-600 text-sm">
              See how FINZA helps you manage invoicing, expenses, and more. Ready to try it yourself?{" "}
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
