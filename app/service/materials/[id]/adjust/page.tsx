"use client"

import { useEffect } from "react"
import { useRouter, useParams } from "next/navigation"

/** Legacy route — redirect to Add stock. */
export default function ServiceMaterialAdjustRedirectPage() {
  const router = useRouter()
  const params = useParams()
  const id = typeof params?.id === "string" ? params.id : ""

  useEffect(() => {
    if (id) router.replace(`/service/materials/${id}/add-stock`)
    else router.replace("/service/materials")
  }, [id, router])

  return null
}
