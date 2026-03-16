"use client"

/**
 * Books-Only Client Badge
 * Step 9.2 Batch D
 * 
 * Visual indicator for books-only clients with tooltip
 */
export default function BooksOnlyBadge() {
  return (
    <div className="group relative inline-block">
      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
        Books-Only Client
      </span>
      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
        This client does not use Finza for operations. Accounting only.
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1">
          <div className="border-4 border-transparent border-t-gray-900"></div>
        </div>
      </div>
    </div>
  )
}
