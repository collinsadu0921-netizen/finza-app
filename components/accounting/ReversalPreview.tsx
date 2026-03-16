"use client"

export type ReversalPreviewLine = {
  accountCode: string
  accountName: string
  originalDebit: number
  originalCredit: number
  reversalDebit: number
  reversalCredit: number
}

interface ReversalPreviewProps {
  lines: ReversalPreviewLine[]
}

export default function ReversalPreview({ lines }: ReversalPreviewProps) {
  if (!lines.length) return null

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-700 dark:text-gray-300">
                Account
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-700 dark:text-gray-300">
                Original Debit
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-700 dark:text-gray-300">
                Original Credit
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-700 dark:text-gray-300">
                Reversal Debit
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-700 dark:text-gray-300">
                Reversal Credit
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
            {lines.map((line, idx) => (
              <tr key={idx} className="bg-white dark:bg-gray-800">
                <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">
                  {line.accountCode} {line.accountName ? `— ${line.accountName}` : ""}
                </td>
                <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">
                  {line.originalDebit > 0 ? `₵${line.originalDebit.toFixed(2)}` : "—"}
                </td>
                <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">
                  {line.originalCredit > 0 ? `₵${line.originalCredit.toFixed(2)}` : "—"}
                </td>
                <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">
                  {line.reversalDebit > 0 ? `₵${line.reversalDebit.toFixed(2)}` : "—"}
                </td>
                <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">
                  {line.reversalCredit > 0 ? `₵${line.reversalCredit.toFixed(2)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
