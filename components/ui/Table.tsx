import { ReactNode } from "react"

interface TableProps {
  headers: string[]
  children: ReactNode
  emptyMessage?: string
  emptyAction?: {
    label: string
    onClick: () => void
  }
}

export default function Table({ headers, children, emptyMessage, emptyAction }: TableProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              {headers.map((header, index) => (
                <th
                  key={index}
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {children}
          </tbody>
        </table>
      </div>
      {emptyMessage && (
        <div className="p-12 text-center">
          <p className="text-gray-600 dark:text-gray-400 font-medium mb-1">{emptyMessage}</p>
          {emptyAction && (
            <button
              onClick={emptyAction.onClick}
              className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-sm font-medium mt-2"
            >
              {emptyAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

