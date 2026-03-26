"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getActiveFirmId } from "@/lib/accounting/firm/session"
import { RoleCapabilityMatrix } from "@/components/RoleCapabilityMatrix"
import { FirmRole } from "@/lib/accounting/firm/authority"

/**
 * Authority Matrix Page
 * Shows what each role can do in the Accounting Workspace
 */
export default function AuthorityMatrixPage() {
  const [firmRole, setFirmRole] = useState<FirmRole | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadFirmRole()
  }, [])

  const loadFirmRole = async () => {
    try {
      const firmId = getActiveFirmId()
      if (!firmId) {
        setLoading(false)
        return
      }

      const response = await fetch("/api/accounting/firm/firms")
      if (response.ok) {
        const data = await response.json()
        const firm = data.firms?.find((f: any) => f.firm_id === firmId)
        if (firm) {
          setFirmRole(firm.role as FirmRole)
        }
      }
    } catch (err) {
      console.error("Error loading firm role:", err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="mb-8">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
              Authority Matrix
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              Understand what each role can do in the Accounting Workspace
            </p>
          </div>

          <RoleCapabilityMatrix currentRole={firmRole} />

          <div className="mt-8 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Engagement Access Levels
            </h3>
            <div className="space-y-4">
              <div className="border-l-4 border-blue-500 pl-4">
                <h4 className="font-medium text-gray-900 dark:text-white mb-1">Read</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  View client accounting data, reports, and activity logs. Cannot modify data.
                </p>
              </div>
              <div className="border-l-4 border-green-500 pl-4">
                <h4 className="font-medium text-gray-900 dark:text-white mb-1">Write</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  All read capabilities, plus: apply adjustments, close periods, lock periods.
                </p>
              </div>
              <div className="border-l-4 border-purple-500 pl-4">
                <h4 className="font-medium text-gray-900 dark:text-white mb-1">Approve</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  All write capabilities, plus: approve adjustments, finalize AFS.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
              Important Notes
            </h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-yellow-700 dark:text-yellow-300">
              <li>Authority is determined by both firm role AND engagement access level</li>
              <li>Actions require BOTH the appropriate role AND sufficient engagement access</li>
              <li>Hover over disabled actions to see why they're unavailable</li>
              <li>Contact a Partner to request role changes or engagement access updates</li>
            </ul>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
