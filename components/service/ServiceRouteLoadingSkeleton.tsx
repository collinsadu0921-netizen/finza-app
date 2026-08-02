/**
 * Route-level loading placeholder for /service/* pages.
 * Renders inside the existing ProtectedLayout shell (sidebar remains visible).
 */
export default function ServiceRouteLoadingSkeleton() {
  const pulse = "animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-700/50"

  return (
    <div
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6"
      aria-busy="true"
      aria-label="Loading page"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className={`h-8 w-44 ${pulse}`} />
          <div className={`h-4 w-64 max-w-full ${pulse}`} />
        </div>
        <div className={`h-10 w-28 ${pulse}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/40 space-y-3"
          >
            <div className={`h-4 w-24 ${pulse}`} />
            <div className={`h-8 w-32 ${pulse}`} />
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden dark:border-slate-700 dark:bg-slate-900/40">
        <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-3.5 flex gap-6 flex-wrap dark:border-slate-800 dark:bg-slate-800/30">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={`h-3 w-16 ${pulse}`} />
          ))}
        </div>
        {[1, 2, 3, 4, 5, 6].map((row) => (
          <div
            key={row}
            className="flex items-center gap-5 px-5 py-4 border-b border-slate-100 dark:border-slate-800"
          >
            <div className={`h-4 w-28 ${pulse}`} />
            <div className={`h-4 flex-1 max-w-[140px] ${pulse}`} />
            <div className={`h-4 w-20 ml-auto ${pulse}`} />
            <div className={`h-6 w-20 ${pulse}`} />
          </div>
        ))}
      </div>
    </div>
  )
}
