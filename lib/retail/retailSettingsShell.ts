/**
 * Shared layout tokens for retail admin settings pages.
 * Calm back-office: no page-level gradients.
 */
export const retailSettingsShell = {
  outer: "min-h-screen bg-gray-50 dark:bg-gray-950",
  /** Standard settings width */
  container: "mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8",
  /** Stores list needs more width on desktop */
  containerWide: "mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8",
  backLink: "text-sm font-medium text-blue-600 hover:underline dark:text-blue-400",
  headerBlock: "mb-6",
  title: "mt-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white",
  /** Standalone page H1 (no eyebrow above — avoids extra top margin) */
  pageTitle: "text-2xl font-bold tracking-tight text-gray-900 dark:text-white",
  subtitle: "mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400",
  /** Page actions row (title + primary) */
  actionsRow: "mt-4 flex flex-col gap-3 sm:mt-0 sm:flex-row sm:items-start sm:justify-between",
  card: "rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900",
  cardPad: "p-6",
  tableWrap:
    "hidden overflow-x-auto overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm md:block dark:border-gray-700 dark:bg-gray-900",
  /** Stacked rows for narrow viewports */
  listStack: "space-y-3 md:hidden",
  listCard: "rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900",
  primaryButton:
    "inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 dark:focus:ring-offset-gray-950",
  secondaryButton:
    "inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700",
  sectionTitle: "text-lg font-semibold text-gray-900 dark:text-white",
  mutedPanel: "rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/60",
  formSectionCard: "rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900",
  /** In-form card (e.g. payment provider blocks) */
  insetCard: "rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900",
  linkInline: "font-medium text-blue-600 hover:underline dark:text-blue-400",
  /** Inline alerts (match tone across retail) */
  alertError:
    "mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200",
  alertSuccess:
    "mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200",
  alertWarning:
    "mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100",
  alertInfo:
    "mb-4 rounded-lg border border-blue-200 bg-blue-50/90 px-4 py-3 text-sm text-blue-950 dark:border-blue-900/40 dark:bg-blue-950/25 dark:text-blue-100",
  loadingCenter: "flex min-h-[12rem] flex-col items-center justify-center text-sm text-gray-600 dark:text-gray-400",
} as const
