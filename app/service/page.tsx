"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

export default function ServicePage() {
  const router = useRouter()
  const { format } = useBusinessCurrency()
  const [loading, setLoading] = useState(true)
  const [business, setBusiness] = useState<{ id: string; name: string } | null>(null)
  const [serviceCount, setServiceCount] = useState(0)
  const [productCount, setProductCount] = useState(0)
  const [recentServices, setRecentServices] = useState<Array<{ id: string; name: string; unit_price: number; updated_at: string }>>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setLoading(false)
          return
        }
        const b = await getCurrentBusiness(supabase, user.id)
        if (cancelled || !b) {
          setLoading(false)
          return
        }
        setBusiness(b)

        const isService = b.industry === "service"
        if (isService) {
          const { data: services } = await supabase
            .from("products_services")
            .select("id, name, unit_price, updated_at")
            .eq("business_id", b.id)
            .eq("type", "service")
            .is("deleted_at", null)
            .order("updated_at", { ascending: false })
            .limit(5)
          if (!cancelled && services) setRecentServices(services)
          const { count } = await supabase
            .from("products_services")
            .select("id", { count: "exact", head: true })
            .eq("business_id", b.id)
            .eq("type", "service")
            .is("deleted_at", null)
          if (!cancelled) setServiceCount(count ?? 0)
        } else {
          const { count } = await supabase
            .from("products")
            .select("id", { count: "exact", head: true })
            .eq("business_id", b.id)
          if (!cancelled) setProductCount(count ?? 0)
        }
      } catch (_) {
        // ignore
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      
        <div className="p-6">
          <p>Loading...</p>
        </div>
      
    )
  }

  const isService = business && (business as { industry?: string }).industry === "service"

  return (
    
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Services & Products</h1>
        <p className="text-gray-600 mb-6">
          Manage your {isService ? "services" : "products"} and use them on quotes and invoices.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
          <Link
            href={isService ? "/products/create-service" : "/products/new"}
            className="flex flex-col p-4 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-blue-200 transition-colors"
          >
            <span className="font-semibold text-gray-900">
              {isService ? "Create service" : "Create product"}
            </span>
            <span className="text-sm text-gray-500 mt-1">
              Add a new {isService ? "service" : "product"} to your catalog
            </span>
          </Link>
          <Link
            href="/products"
            className="flex flex-col p-4 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-blue-200 transition-colors"
          >
            <span className="font-semibold text-gray-900">View catalog</span>
            <span className="text-sm text-gray-500 mt-1">
              {isService ? `${serviceCount} services` : `${productCount} products`}
            </span>
          </Link>
          <Link
            href="/estimates/new"
            className="flex flex-col p-4 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-blue-200 transition-colors"
          >
            <span className="font-semibold text-gray-900">Create quote</span>
            <span className="text-sm text-gray-500 mt-1">New quote from catalog</span>
          </Link>
        </div>

        {isService && recentServices.length > 0 && (
          <div className="border border-gray-200 rounded-lg p-4">
            <h2 className="font-semibold text-gray-900 mb-3">Last updated services</h2>
            <ul className="space-y-2">
              {recentServices.map((s) => (
                <li key={s.id} className="flex justify-between items-center text-sm">
                  <Link href={`/products/${s.id}/edit`} className="text-blue-600 hover:underline">
                    {s.name}
                  </Link>
                  <span className="text-gray-600">{format(Number(s.unit_price || 0))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(isService ? serviceCount === 0 : productCount === 0) && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
            <p className="text-gray-600 mb-4">
              You don&apos;t have any {isService ? "services" : "products"} yet. Create one to use on quotes and invoices.
            </p>
            <button
              type="button"
              onClick={() => router.push(isService ? "/products/create-service" : "/products/new")}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium"
            >
              {isService ? "Create service" : "Create product"}
            </button>
          </div>
        )}
      </div>
    
  )
}
