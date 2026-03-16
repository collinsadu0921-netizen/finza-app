"use client"

"use client"

import React from "react"
import { FirmRole, EngagementAccessLevel, ActionType, EngagementStatus, resolveAuthority } from "@/lib/firmAuthority"

interface AuthorityGuardProps {
  userRole: FirmRole | null
  engagementAccess: EngagementAccessLevel | null
  actionType: ActionType
  children: React.ReactNode
  fallback?: React.ReactNode
  showExplanation?: boolean
}

/**
 * AuthorityGuard Component
 * Conditionally renders children based on authority check
 * Shows explanation if action is blocked
 */
export function AuthorityGuard({
  userRole,
  engagementAccess,
  actionType,
  children,
  fallback,
  showExplanation = true,
}: AuthorityGuardProps) {
  const check = canPerformAction(userRole, engagementAccess, actionType)

  if (check.canPerform) {
    return <>{children}</>
  }

  if (fallback) {
    return <>{fallback}</>
  }

  return (
    <div className="relative group">
      <div className="opacity-50 pointer-events-none">{children}</div>
      {showExplanation && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 rounded-lg z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 max-w-sm shadow-xl">
            <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
              Action Not Available
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
              {check.reason}
            </p>
            {check.escalationHint && (
              <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                💡 {check.escalationHint}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface DisabledActionButtonProps {
  userRole: FirmRole | null
  engagementAccess: EngagementAccessLevel | null
  actionType: ActionType
  className?: string
  children: React.ReactNode
  onClick?: () => void
}

/**
 * DisabledActionButton Component
 * Button that shows disabled state with explanation tooltip
 */
export function DisabledActionButton({
  userRole,
  engagementAccess,
  actionType,
  className = "",
  children,
  onClick,
}: DisabledActionButtonProps) {
  const resolution = resolveAuthority({
    firmRole: userRole,
    engagementAccess,
    action: actionType,
    engagementStatus: engagementAccess ? "active" : null,
  })

  const handleClick = async (e: React.MouseEvent) => {
    if (!resolution.allowed) {
      e.preventDefault()
      e.stopPropagation()

      // Log blocked action attempt (user explicitly clicked)
      // Note: This is done client-side, so we use a simple fetch to the API
      // The actual logging should be done server-side when the action is attempted
      try {
        const firmId = typeof window !== "undefined" ? sessionStorage.getItem("finza_active_firm_id") : null
        if (firmId) {
          // Call API to log blocked action (if endpoint exists)
          // For now, we'll just prevent the action
          console.warn("Action blocked:", {
            action: actionType,
            reason: resolution.reason,
            reasonCode: resolution.reasonCode,
          })
        }
      } catch (error) {
        console.error("Error logging blocked action:", error)
      }

      return
    }

    if (onClick) {
      onClick()
    }
  }

  if (resolution.allowed) {
    return (
      <button onClick={onClick} className={className}>
        {children}
      </button>
    )
  }

  return (
    <div className="relative group">
      <button
        disabled
        className={`${className} opacity-50 cursor-not-allowed`}
        onClick={handleClick}
      >
        {children}
      </button>
      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
        <div className="bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-lg whitespace-nowrap">
          <div className="font-medium mb-1">Action Not Available</div>
          <div className="text-gray-300">{resolution.reason}</div>
          {resolution.escalationHint && (
            <div className="mt-1 text-blue-300 font-medium">
              💡 {resolution.escalationHint}
            </div>
          )}
          <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full">
            <div className="border-4 border-transparent border-t-gray-900"></div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface AuthorityBadgeProps {
  userRole: FirmRole | null
  engagementAccess: EngagementAccessLevel | null
  actionType: ActionType
  className?: string
}

/**
 * AuthorityBadge Component
 * Shows authority status for an action
 */
export function AuthorityBadge({
  userRole,
  engagementAccess,
  actionType,
  className = "",
}: AuthorityBadgeProps) {
  const check = canPerformAction(userRole, engagementAccess, actionType)

  if (check.canPerform) {
    return (
      <span
        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 ${className}`}
      >
        ✓ Authorized
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 ${className}`}
      title={check.reason}
    >
      ✗ Not Authorized
    </span>
  )
}
