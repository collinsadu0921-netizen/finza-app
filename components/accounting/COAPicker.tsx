"use client"

import { useState, useEffect } from "react"

type Account = {
  id: string
  code: string
  name: string
  type: "asset" | "liability" | "equity" | "income" | "expense"
  description: string | null
  is_system: boolean
}

type COAPickerProps = {
  businessId: string
  value?: string | null
  onChange: (accountId: string | null) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  restrictToType?: "asset" | "liability" | "equity" // Optional: restrict to specific type (for equity offset)
}

/**
 * COAPicker Component
 * 
 * A read-only, filtered account picker for opening balances.
 * 
 * Features:
 * - Filters allowed account types (asset, liability, equity)
 * - Excludes system accounts (is_system = true)
 * - Client-side filtering for UX
 * - Server-side validation required (security)
 * 
 * Eligibility Rules (enforced client-side, must be validated server-side):
 * - Allowed: asset, liability, equity
 * - Forbidden: income, expense, system accounts
 */
export default function COAPicker({
  businessId,
  value,
  onChange,
  placeholder = "Select account...",
  disabled = false,
  className = "",
  restrictToType,
}: COAPickerProps) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!businessId) {
      setError("Business ID is required")
      setLoading(false)
      return
    }

    loadAccounts()
  }, [businessId])

  const loadAccounts = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(`/api/accounting/coa?business_id=${businessId}`)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to load accounts")
      }

      const data = await response.json()
      
      // Filter accounts client-side (UX only - server must validate)
      // Allowed: asset, liability, equity (or restrictToType if specified)
      // Forbidden: income, expense, system accounts
      const allowedAccounts = (data.accounts || []).filter((account: Account) => {
        if (restrictToType) {
          // Restrict to specific type (e.g., equity only for equity offset)
          const isAllowedType = account.type === restrictToType
          const isNotSystem = !account.is_system
          return isAllowedType && isNotSystem
        } else {
          // Default: allow asset, liability, equity
          const isAllowedType = ["asset", "liability", "equity"].includes(account.type)
          const isNotSystem = !account.is_system
          return isAllowedType && isNotSystem
        }
      })

      setAccounts(allowedAccounts)
    } catch (err: any) {
      console.error("Error loading accounts:", err)
      setError(err.message || "Failed to load accounts")
    } finally {
      setLoading(false)
    }
  }

  const filteredAccounts = accounts.filter((account) => {
    if (!searchTerm) return true
    const search = searchTerm.toLowerCase()
    return (
      account.code.toLowerCase().includes(search) ||
      account.name.toLowerCase().includes(search) ||
      account.type.toLowerCase().includes(search)
    )
  })

  const selectedAccount = accounts.find((a) => a.id === value)

  const formatAccountLabel = (account: Account) => {
    const typeLabels: Record<string, string> = {
      asset: "Asset",
      liability: "Liability",
      equity: "Equity",
    }
    return `${account.code} - ${account.name} (${typeLabels[account.type] || account.type})`
  }

  return (
    <div className={`relative ${className}`}>
      {/* Input/Display */}
      <div
        onClick={() => !disabled && !loading && setIsOpen(!isOpen)}
        className={`
          w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2
          bg-white dark:bg-gray-700 text-gray-900 dark:text-white
          cursor-pointer hover:border-blue-500 dark:hover:border-blue-400
          transition-colors
          ${disabled || loading ? "opacity-50 cursor-not-allowed" : ""}
        `}
      >
        {loading ? (
          <span className="text-gray-500 dark:text-gray-400">Loading accounts...</span>
        ) : error ? (
          <span className="text-red-600 dark:text-red-400">{error}</span>
        ) : selectedAccount ? (
          <span className="text-sm font-medium">{formatAccountLabel(selectedAccount)}</span>
        ) : (
          <span className="text-gray-500 dark:text-gray-400">{placeholder}</span>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && !disabled && !loading && !error && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown Menu */}
          <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-64 overflow-auto">
            {/* Search */}
            <div className="p-2 border-b border-gray-200 dark:border-gray-700">
              <input
                type="text"
                placeholder="Search by code or name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Account List */}
            <div className="py-1">
              {filteredAccounts.length === 0 ? (
                <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">
                  {searchTerm ? "No accounts found" : "No eligible accounts available"}
                </div>
              ) : (
                filteredAccounts.map((account) => {
                  const isSelected = account.id === value
                  return (
                    <div
                      key={account.id}
                      onClick={() => {
                        onChange(account.id)
                        setIsOpen(false)
                        setSearchTerm("")
                      }}
                      className={`
                        px-4 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700
                        transition-colors
                        ${isSelected ? "bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500" : ""}
                      `}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {account.code} - {account.name}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {account.type.charAt(0).toUpperCase() + account.type.slice(1)}
                            {account.description && ` • ${account.description}`}
                          </div>
                        </div>
                        {isSelected && (
                          <svg
                            className="w-5 h-5 text-blue-600 dark:text-blue-400"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Info Footer */}
            <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 dark:text-gray-400">
              Showing {filteredAccounts.length} of {accounts.length} eligible accounts
              <br />
              <span className="text-yellow-600 dark:text-yellow-400">
                Only asset, liability, and equity accounts (non-system) are shown
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
