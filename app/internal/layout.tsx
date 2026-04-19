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
    return (
      <div className="min-h-screen bg-gray-50 p-8 dark:bg-gray-950">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Access denied</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Internal tools are restricted. Ask a Finza administrator to add your email to{" "}
          <code className="rounded bg-gray-200 px-1 dark:bg-gray-800">INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS</code>.
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
