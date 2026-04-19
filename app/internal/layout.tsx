import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { isInternalAnnouncementAdminEmail } from "@/lib/internalAnnouncementsAdmin"

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login?next=/internal/announcements")
  }

  if (!isInternalAnnouncementAdminEmail(user.email)) {
    const sessionEmail = user.email?.trim() || null
    const allowlistConfigured = Boolean(process.env.INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS?.trim())
    return (
      <div className="min-h-screen bg-gray-50 p-8 dark:bg-gray-950">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Access denied</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Internal tools are restricted. A Finza administrator must add your login email to{" "}
          <code className="rounded bg-gray-200 px-1 dark:bg-gray-800">INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS</code>{" "}
          in Vercel (Production) and redeploy.
        </p>
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-medium">Your session email (add this exact address to the allowlist)</p>
          <p className="mt-1 font-mono text-base">
            {sessionEmail ?? "— none on this account (use an email/password or OAuth identity that has an email)"}
          </p>
          {!allowlistConfigured && (
            <p className="mt-2 text-xs">
              <strong>Note:</strong> <code className="rounded bg-black/5 px-1">INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS</code> does not
              appear to be set in this deployment&apos;s environment. If you already added it in Vercel, trigger a new Production
              deploy so serverless picks it up.
            </p>
          )}
        </div>
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
          Value format: comma-separated, case-insensitive, e.g.{" "}
          <code className="rounded bg-gray-200 px-1 dark:bg-gray-800">you@finza.africa,colleague@finza.africa</code>
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Finza internal</span>
      </header>
      <div className="mx-auto max-w-4xl px-4 py-6">{children}</div>
    </div>
  )
}
