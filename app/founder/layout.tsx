import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { isFinzaFounderAccess } from "@/lib/founder/isFinzaFounder"

export default async function FounderLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login?next=/founder/akwasi")
  }

  if (!isFinzaFounderAccess(user)) {
    const allowlistConfigured = Boolean(process.env.FINZA_FOUNDER_USER_ID?.trim())
    return (
      <div className="min-h-screen bg-gray-50 p-8 dark:bg-gray-950">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Access denied</h1>
        <p className="mt-2 max-w-xl text-gray-600 dark:text-gray-400">
          Akwasi and founder tools are restricted to the Finza founder. Set{" "}
          <code className="rounded bg-gray-200 px-1 dark:bg-gray-800">FINZA_FOUNDER_USER_ID</code> to your
          Supabase user UUID, or set{" "}
          <code className="rounded bg-gray-200 px-1 dark:bg-gray-800">app_metadata.finza_platform_owner</code>{" "}
          to <code className="rounded bg-gray-200 px-1 dark:bg-gray-800">true</code> for this user in Supabase Auth.
        </p>
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-medium">Your user id (for FINZA_FOUNDER_USER_ID)</p>
          <p className="mt-1 font-mono text-base break-all">{user.id}</p>
          {!allowlistConfigured && (
            <p className="mt-2 text-xs">
              <strong>Note:</strong> <code className="rounded bg-black/5 px-1">FINZA_FOUNDER_USER_ID</code> does not
              appear to be set in this environment.
            </p>
          )}
        </div>
        <p className="mt-6 text-sm text-gray-600 dark:text-gray-400">
          This page is not linked from tenant dashboards or workspace sidebars.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Finza founder</span>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
    </div>
  )
}
