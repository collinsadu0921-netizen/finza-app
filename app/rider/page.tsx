"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function RiderPage() {
  const router = useRouter()

  useEffect(() => {
    router.push("/rider/deliveries")
  }, [router])

  return (
    <div className="p-6">
      <p>Redirecting...</p>
    </div>
  )
}






















