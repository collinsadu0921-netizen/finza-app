"use client"

import { useState, useEffect } from "react"
import { setActiveStoreId } from "@/lib/storeSession"

type Store = {
  id: string
  name: string
  location: string | null
}

interface StorePickerModalProps {
  isOpen: boolean
  stores: Store[]
  selectedStoreId: string | null
  onStoreSelect: (storeId: string) => void
}

export default function StorePickerModal({
  isOpen,
  stores,
  selectedStoreId,
  onStoreSelect,
}: StorePickerModalProps) {
  const [localSelectedStoreId, setLocalSelectedStoreId] = useState<string>("")

  useEffect(() => {
    if (isOpen && stores.length > 0) {
      // Pre-select first store if none selected
      if (!selectedStoreId && stores.length > 0) {
        setLocalSelectedStoreId(stores[0].id)
      } else if (selectedStoreId) {
        setLocalSelectedStoreId(selectedStoreId)
      }
    }
  }, [isOpen, stores, selectedStoreId])

  // Prevent ESC key from closing modal
  useEffect(() => {
    if (isOpen) {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
        }
      }
      document.addEventListener("keydown", handleEscape)
      return () => {
        document.removeEventListener("keydown", handleEscape)
      }
    }
  }, [isOpen])

  const handleEnterPOS = () => {
    if (localSelectedStoreId) {
      const selectedStore = stores.find((s) => s.id === localSelectedStoreId)
      if (selectedStore) {
        setActiveStoreId(localSelectedStoreId, selectedStore.name)
        onStoreSelect(localSelectedStoreId)
      }
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[9999] overflow-y-auto">
      {/* Backdrop - non-clickable */}
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
      
      {/* Modal */}
      <div className="flex min-h-screen items-center justify-center p-4">
        <div
          className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Select Store
            </h2>
            {/* No close button - modal cannot be dismissed */}
          </div>

          {/* Content */}
          <div className="p-6">
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              POS requires a specific store to operate. Please select a store to continue.
            </p>

            <div className="mb-6">
              <label
                htmlFor="store-select"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Store
              </label>
              <select
                id="store-select"
                value={localSelectedStoreId}
                onChange={(e) => setLocalSelectedStoreId(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name} {store.location ? `(${store.location})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleEnterPOS}
              disabled={!localSelectedStoreId}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              Enter POS
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

