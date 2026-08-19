import Link from "next/link"
import PracticeClientBooksBar from "@/components/practice/PracticeClientBooksBar"
import type { PracticeClientBooksContext } from "@/lib/practice/resolvePracticeClientBooksContext"

type Props = {
  context: PracticeClientBooksContext
  children: React.ReactNode
}

export default function PracticeClientBooksFrame({ context, children }: Props) {
  if (context.kind === "denied") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Access denied</h1>
        <p className="mt-2 text-sm text-slate-600">
          You do not have an effective engagement for this client&apos;s books.
        </p>
        <p className="mt-1 text-xs text-slate-500">Reason: {context.reason}</p>
        <Link
          href="/accounting/clients"
          className="mt-6 inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Back to Practice clients
        </Link>
      </div>
    )
  }

  if (context.kind === "no_context") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Select a client</h1>
        <p className="mt-2 text-sm text-slate-600">
          Open client books from Finza Practice so the correct client context is applied.
        </p>
        <Link
          href="/accounting/clients"
          className="mt-6 inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Go to Practice clients
        </Link>
      </div>
    )
  }

  if (context.kind === "practice") {
    return (
      <div className="px-4 py-4 sm:px-6">
        <PracticeClientBooksBar
          clientName={context.clientName}
          businessId={context.businessId}
          accessLevel={context.accessLevel}
        />
        {children}
      </div>
    )
  }

  return <>{children}</>
}
