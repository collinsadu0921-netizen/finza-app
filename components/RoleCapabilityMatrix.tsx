"use client"

import React from "react"
import { FirmRole, AUTHORITY_MATRIX, getRoleCapabilities, ActionType } from "@/lib/firmAuthority"

interface RoleCapabilityMatrixProps {
  currentRole: FirmRole | null
  className?: string
}

/**
 * RoleCapabilityMatrix Component
 * Displays what each role can do in the Accounting Workspace
 */
export function RoleCapabilityMatrix({
  currentRole,
  className = "",
}: RoleCapabilityMatrixProps) {
  const roles: FirmRole[] = ["partner", "senior", "junior", "readonly"]
  const actions = Object.keys(AUTHORITY_MATRIX) as ActionType[]

  const getActionLabel = (action: ActionType): string => {
    return AUTHORITY_MATRIX[action].description
  }

  const canRolePerformAction = (role: FirmRole, action: ActionType): boolean => {
    const requirement = AUTHORITY_MATRIX[action]
    const roleHierarchy: Record<FirmRole, number> = {
      readonly: 0,
      junior: 1,
      senior: 2,
      partner: 3,
    }

    return roleHierarchy[role] >= roleHierarchy[requirement.minFirmRole]
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 ${className}`}>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Role Capability Matrix
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Your current role: <strong className="text-gray-900 dark:text-white">{currentRole || "None"}</strong>
      </p>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Action
              </th>
              {roles.map((role) => (
                <th
                  key={role}
                  className={`px-4 py-3 text-center text-xs font-medium uppercase tracking-wider ${
                    role === currentRole
                      ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {actions.map((action) => (
              <tr key={action}>
                <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                  {getActionLabel(action)}
                </td>
                {roles.map((role) => {
                  const canPerform = canRolePerformAction(role, action)
                  return (
                    <td key={role} className="px-4 py-3 text-center">
                      {canPerform ? (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs font-medium">
                          ✓
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500 text-xs font-medium">
                          —
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {currentRole && (
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-2">
            Your Capabilities
          </h4>
          <p className="text-sm text-blue-800 dark:text-blue-300">
            {getRoleCapabilities(currentRole)}
          </p>
        </div>
      )}
    </div>
  )
}
