"use client"

import { useEffect } from "react"
import { useRouter, useParams } from "next/navigation"

export default function AssetRedirectPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  useEffect(() => {
    // Redirect to view page
    router.replace(`/assets/${id}/view`)
  }, [id, router])

  return (
    <div className="p-6">
      <p>Redirecting...</p>
    </div>
  )
}

