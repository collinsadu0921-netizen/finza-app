import HelpCenterClient from "@/components/support/HelpCenterClient"

export const metadata = {
  title: "Help & Support | Finza",
  description: "Search guides and contact Finza support",
}

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Help & Support
          </h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            Find step-by-step guides for invoices, payments, credit notes, and more.
          </p>
        </header>
        <HelpCenterClient />
      </div>
    </div>
  )
}
