"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useToast } from "@/components/ui/ToastProvider"

export default function EstimateConvertPage() {
  const router = useRouter()
  const params = useParams()
  const { id: estimateId } = params as { id?: string }
  const toast = useToast()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!estimateId) return
    convertEstimate()
  }, [estimateId])

  const convertEstimate = async () => {
    if (!estimateId) {
      console.error("Missing estimateId")
      return
    }
    setLoading(true)
    try {
      const response = await fetch(`/api/estimates/convert/${estimateId}`, {
        method: "POST",
      })

      const data = await response.json()

      if (response.ok) {
        const targetPath = `/service/invoices/${data.invoice.id}/view`
        console.log("Estimate conversion response JSON:", data)
        console.log("Redirecting to:", targetPath)
        router.push(targetPath)
      } else {
        toast.showToast(data.error || "Error converting quote", "error")
        router.push("/service/estimates")
      }
    } catch (error) {
      console.error("Error converting estimate:", error)
      toast.showToast("Error converting quote", "error")
      router.push("/service/estimates")
    } finally {
      setLoading(false)
    }
  }

  return (
    <ProtectedLayout>
      <div className="p-6">
        {loading ? <p>Converting quote to invoice...</p> : <p>Redirecting...</p>}
      </div>
    </ProtectedLayout>
  )
}


