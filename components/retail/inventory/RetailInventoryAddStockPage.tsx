"use client"

import { useEffect, useState } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { retailPaths } from "@/lib/retail/routes"
import StockAdjustmentModal from "@/components/StockAdjustmentModal"
import {
  RetailBackofficeBackLink,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  RetailBackofficeAlert,
} from "@/components/retail/RetailBackofficeUi"

export default function RetailInventoryAddStockPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const productId = String(params.id || "")
  const variantIdRaw = searchParams.get("variant_id")
  const variantId = variantIdRaw && variantIdRaw.trim() ? variantIdRaw.trim() : null
  const variantNameRaw = searchParams.get("variant_name")
  const variantNameDecoded = variantNameRaw ? decodeURIComponent(variantNameRaw) : undefined

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [productName, setProductName] = useState("")
  const [productBarcode, setProductBarcode] = useState<string | null>(null)
  const [businessId, setBusinessId] = useState("")
  const [userId, setUserId] = useState("")
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setError("")
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          setError("Not signed in")
          return
        }
        if (cancelled) return
        setUserId(user.id)

        const business = await getCurrentBusiness(supabase, user.id)
        if (!business) {
          setError("Business not found")
          return
        }
        if (cancelled) return
        setBusinessId(business.id)

        const { data: product, error: pErr } = await supabase
          .from("products")
          .select("id, name, barcode")
          .eq("id", productId)
          .eq("business_id", business.id)
          .maybeSingle()

        if (cancelled) return
        if (pErr || !product) {
          setError("Product not found or you do not have access.")
          return
        }

        setProductName(product.name)
        setProductBarcode(product.barcode?.trim() ? product.barcode : null)
        setReady(true)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to load product"
        if (!cancelled) setError(msg)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [productId])

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-xl">
        <RetailBackofficeBackLink onClick={() => router.push(retailPaths.inventory)}>Back to inventory</RetailBackofficeBackLink>

        <RetailBackofficePageHeader
          eyebrow="Inventory"
          title="Adjust stock"
          description={
            variantId
              ? "You are adjusting a variant SKU. Quantities apply to this variant only; parent product stock is not used when variants exist."
              : "Add, remove, or set exact on-hand quantity for the selected store. Every save is recorded in stock movements for audit."
          }
        />

        {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}

        {error && !loading ? (
          <RetailBackofficeAlert tone="error" className="mb-6">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        {ready && userId && businessId && productName ? (
          <StockAdjustmentModal
            presentation="inline"
            isOpen
            onClose={() => router.push(retailPaths.inventory)}
            onSuccess={() => router.push(retailPaths.inventory)}
            product={{
              id: productId,
              name: productName,
            }}
            businessId={businessId}
            userId={userId}
            variantId={variantId}
            variantName={variantNameDecoded}
            productBarcode={productBarcode}
          />
        ) : null}
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
