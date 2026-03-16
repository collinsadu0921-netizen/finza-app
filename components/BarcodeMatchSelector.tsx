"use client"

type Match = {
  id: string
  name: string
  price: number
  type: "product" | "variant"
  variantName?: string
  productId: string
  variantId?: string
}

type BarcodeMatchSelectorProps = {
  matches: Match[]
  barcode: string
  onSelect: (match: Match) => void
  onClose: () => void
}

export default function BarcodeMatchSelector({
  matches,
  barcode,
  onSelect,
  onClose,
}: BarcodeMatchSelectorProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-bold mb-4 dark:text-white">
          Multiple matches for barcode: {barcode}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Please select the item to add:
        </p>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {matches.map((match) => (
            <button
              key={match.id}
              onClick={() => onSelect(match)}
              className="w-full text-left p-3 border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <div className="font-semibold dark:text-white">{match.name}</div>
              {match.variantName && (
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Variant: {match.variantName}
                </div>
              )}
              <div className="text-sm text-blue-600 dark:text-blue-400">
                GHS {match.price.toFixed(2)}
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full bg-gray-300 dark:bg-gray-700 text-gray-800 dark:text-white px-4 py-2 rounded hover:bg-gray-400 dark:hover:bg-gray-600"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}







