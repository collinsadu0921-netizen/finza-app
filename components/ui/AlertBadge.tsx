"use client"

import { useState, useEffect } from "react"

interface AlertBadgeProps {
  businessId?: string
  className?: string
}

export default function AlertBadge({ businessId, className = "" }: AlertBadgeProps) {
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!businessId) return

    const fetchUnreadCount = async () => {
      try {
        const response = await fetch(`/api/alerts?unread_only=true&limit=1`)
        if (response.ok) {
          const data = await response.json()
          setUnreadCount(data.unread_count || 0)
        }
      } catch (error) {
        console.error("Error fetching unread alerts:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchUnreadCount()

    // Poll for new alerts every 30 seconds
    const interval = setInterval(fetchUnreadCount, 30000)
    return () => clearInterval(interval)
  }, [businessId])

  if (loading || unreadCount === 0) {
    return null
  }

  return (
    <span
      className={`inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-red-600 rounded-full ${className}`}
      title={`${unreadCount} unread alert${unreadCount !== 1 ? "s" : ""}`}
    >
      {unreadCount > 99 ? "99+" : unreadCount}
    </span>
  )
}













