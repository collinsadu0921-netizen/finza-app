"use client"

import { useEffect } from "react"
import { useRouter, useParams } from "next/navigation"

export default function EstimateViewRedirect() {
  const router = useRouter()
  const params = useParams()
  const estimateId = params.id as string

  useEffect(() => {
    // Redirect to view page
    if (estimateId) {
      router.replace(`/service/estimates/${estimateId}/view`)
    }
  }, [router, estimateId])

  return (
    <div className="p-6">
      <p>Redirecting...</p>
    </div>
  )
}


