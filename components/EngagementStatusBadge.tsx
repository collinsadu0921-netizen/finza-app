"use client"

import React from "react"

export type EngagementStatus = "pending" | "accepted" | "active" | "suspended" | "terminated"

const STATUS_CONFIG: Record<
  EngagementStatus,
  { label: string; color: string; bgColor: string }
> = {
  pending: {
    label: "Pending",
    color: "text-yellow-800 dark:text-yellow-200",
    bgColor: "bg-yellow-100 dark:bg-yellow-900/20",
  },
  accepted: {
    label: "Accepted",
    color: "text-blue-800 dark:text-blue-200",
    bgColor: "bg-blue-100 dark:bg-blue-900/20",
  },
  active: {
    label: "Active",
    color: "text-green-800 dark:text-green-200",
    bgColor: "bg-green-100 dark:bg-green-900/20",
  },
  suspended: {
    label: "Suspended",
    color: "text-orange-800 dark:text-orange-200",
    bgColor: "bg-orange-100 dark:bg-orange-900/20",
  },
  terminated: {
    label: "Terminated",
    color: "text-red-800 dark:text-red-200",
    bgColor: "bg-red-100 dark:bg-red-900/20",
  },
}

const FALLBACK_STATUS_CONFIG = {
  label: "Unknown",
  bgColor: "bg-gray-100",
  color: "text-gray-800",
}

interface EngagementStatusBadgeProps {
  status?: string | null
  className?: string
}

/**
 * EngagementStatusBadge Component
 * Shows engagement status with appropriate styling
 */
export function EngagementStatusBadge({
  status,
  className = "",
}: EngagementStatusBadgeProps) {
  const safeStatus =
    typeof status === "string" ? status.toLowerCase() : undefined

  const config =
    (safeStatus && safeStatus in STATUS_CONFIG
      ? STATUS_CONFIG[safeStatus as EngagementStatus]
      : null) || FALLBACK_STATUS_CONFIG

  if (!safeStatus || !(safeStatus in STATUS_CONFIG)) {
    console.warn("[EngagementStatusBadge] Unknown status:", status)
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bgColor} ${config.color} ${className}`}
    >
      {config.label}
    </span>
  )
}

interface AccessLevelBadgeProps {
  level: "read" | "write" | "approve"
  className?: string
}

/**
 * AccessLevelBadge Component
 * Shows engagement access level
 */
export function AccessLevelBadge({ level, className = "" }: AccessLevelBadgeProps) {
  const levelConfig: Record<
    "read" | "write" | "approve",
    { label: string; color: string; bgColor: string }
  > = {
    read: {
      label: "Read",
      color: "text-blue-800 dark:text-blue-200",
      bgColor: "bg-blue-100 dark:bg-blue-900/20",
    },
    write: {
      label: "Write",
      color: "text-green-800 dark:text-green-200",
      bgColor: "bg-green-100 dark:bg-green-900/20",
    },
    approve: {
      label: "Approve",
      color: "text-purple-800 dark:text-purple-200",
      bgColor: "bg-purple-100 dark:bg-purple-900/20",
    },
  }

  const config = levelConfig[level]

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bgColor} ${config.color} ${className}`}
    >
      {config.label}
    </span>
  )
}
