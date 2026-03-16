"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { getCurrencySymbol } from "@/lib/currency"
import { formatMoney } from "@/lib/money"

type Product = {
  id: string
  name: string
  price: number
  barcode?: string
}

type Variant = {
  id: string
  variant_name: string
  price: number | null
  barcode?: string
  product_id: string
  product_name: string
}

export default function PrintBarcodePage() {
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>([])
  const [variants, setVariants] = useState<Variant[]>([])
  const [selectedType, setSelectedType] = useState<"product" | "variant">("product")
  const [selectedId, setSelectedId] = useState<string>("")
  const [quantity, setQuantity] = useState(1)
  const [loading, setLoading] = useState(true)
  const [businessId, setBusinessId] = useState("")
  const [currencyCode, setCurrencyCode] = useState<string | null>(null)

  useEffect(() => {
    // Load jsbarcode from CDN
    const script = document.createElement("script")
    script.src = "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"
    script.async = true
    document.body.appendChild(script)

    loadData()

    return () => {
      document.body.removeChild(script)
    }
  }, [])

  useEffect(() => {
    if (selectedId && selectedType === "product") {
      generateBarcode(selectedId, "product")
    } else if (selectedId && selectedType === "variant") {
      generateBarcode(selectedId, "variant")
    }
  }, [selectedId, selectedType])

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setLoading(false)
        return
      }

      setBusinessId(business.id)

      // Load business currency
      const { data: businessDetails } = await supabase
        .from("businesses")
        .select("default_currency")
        .eq("id", business.id)
        .single()
      setCurrencyCode(businessDetails?.default_currency || null)

      // Load products with barcodes
      const { data: prods } = await supabase
        .from("products")
        .select("id, name, price, barcode")
        .eq("business_id", business.id)
        .not("barcode", "is", null)
        .order("name", { ascending: true })

      if (prods) {
        setProducts(prods)
      }

      // Load variants with barcodes
      const { data: vars } = await supabase
        .from("products_variants")
        .select("id, variant_name, price, barcode, product_id")
        .not("barcode", "is", null)
        .order("variant_name", { ascending: true })

      if (vars) {
        // Get product names for variants
        const productIds = Array.from(new Set(vars.map((v) => v.product_id)))
        const { data: prodsForVariants } = await supabase
          .from("products")
          .select("id, name")
          .eq("business_id", business.id)
          .in("id", productIds)

        if (prodsForVariants) {
          const productMap = new Map(prodsForVariants.map((p) => [p.id, p.name]))
          setVariants(
            vars
              .filter((v) => productMap.has(v.product_id))
              .map((v) => ({
                ...v,
                product_name: productMap.get(v.product_id) || "Unknown",
              }))
          )
        }
      }

      setLoading(false)
    } catch (err) {
      console.error("Error loading data:", err)
      setLoading(false)
    }
  }

  const generateBarcode = (id: string, type: "product" | "variant") => {
    // Clear existing barcodes
    const container = document.getElementById("barcode-container")
    if (container) {
      container.innerHTML = ""
    }

    let barcodeValue = ""
    let itemName = ""
    let itemPrice = 0

    if (type === "product") {
      const product = products.find((p) => p.id === id)
      if (product && product.barcode) {
        barcodeValue = product.barcode
        itemName = product.name
        itemPrice = product.price
      }
    } else {
      const variant = variants.find((v) => v.id === id)
      if (variant && variant.barcode) {
        barcodeValue = variant.barcode
        itemName = `${variant.product_name} - ${variant.variant_name}`
        itemPrice = variant.price !== null ? variant.price : 0
      }
    }

    if (!barcodeValue || !container) return

    // Generate barcode labels
    for (let i = 0; i < quantity; i++) {
      const label = document.createElement("div")
      label.className = "barcode-label"
      label.style.cssText = `
        width: 2in;
        height: 1in;
        border: 1px solid #000;
        padding: 8px;
        display: inline-block;
        margin: 4px;
        page-break-inside: avoid;
        text-align: center;
        font-size: 10px;
      `

      const nameDiv = document.createElement("div")
      nameDiv.textContent = itemName
      nameDiv.style.cssText = "font-weight: bold; margin-bottom: 4px; font-size: 9px;"
      label.appendChild(nameDiv)

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
      svg.setAttribute("id", `barcode-${i}`)
      svg.style.cssText = "width: 100%; height: 40px;"
      label.appendChild(svg)

      const codeDiv = document.createElement("div")
      codeDiv.textContent = barcodeValue
      codeDiv.style.cssText = "font-size: 8px; margin-top: 2px;"
      label.appendChild(codeDiv)

      const priceDiv = document.createElement("div")
      priceDiv.textContent = formatMoney(itemPrice, currencyCode)
      priceDiv.style.cssText = "font-weight: bold; margin-top: 2px; font-size: 9px;"
      label.appendChild(priceDiv)

      container.appendChild(label)

      // Generate barcode using JsBarcode (from CDN)
      setTimeout(() => {
        try {
          const JsBarcode = (window as any).JsBarcode
          if (JsBarcode) {
            JsBarcode(`#barcode-${i}`, barcodeValue, {
              format: "CODE128",
              width: 1,
              height: 30,
              displayValue: false,
            })
          } else {
            // Fallback: show text if JsBarcode not loaded
            svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" font-size="10">${barcodeValue}</text>`
          }
        } catch (err) {
          console.error("Error generating barcode:", err)
        }
      }, 100)
    }
  }

  const handlePrint = () => {
    window.print()
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="p-6">
        <div className="mb-6">
          <button
            onClick={() => router.push("/products")}
            className="text-blue-600 hover:underline mb-4"
          >
            ← Back to Products
          </button>
          <h1 className="text-2xl font-bold mb-2">Print Barcode Labels</h1>
          <p className="text-gray-600">Generate printable barcode labels for products or variants</p>
        </div>

        <div className="bg-white border rounded-lg p-6 mb-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Type
              </label>
              <div className="flex gap-4">
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="product"
                    checked={selectedType === "product"}
                    onChange={(e) => {
                      setSelectedType(e.target.value as "product")
                      setSelectedId("")
                    }}
                    className="mr-2"
                  />
                  Product
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="variant"
                    checked={selectedType === "variant"}
                    onChange={(e) => {
                      setSelectedType(e.target.value as "variant")
                      setSelectedId("")
                    }}
                    className="mr-2"
                  />
                  Variant
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select {selectedType === "product" ? "Product" : "Variant"}
              </label>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2"
              >
                <option value="">-- Select --</option>
                {selectedType === "product"
                  ? products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.barcode})
                      </option>
                    ))
                  : variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.product_name} - {v.variant_name} ({v.barcode})
                      </option>
                    ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Number of Labels
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                className="w-full border border-gray-300 rounded px-3 py-2"
              />
            </div>

            <button
              onClick={handlePrint}
              disabled={!selectedId}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Print Labels
            </button>
          </div>
        </div>

        <div id="barcode-container" className="print-area"></div>

        <style jsx global>{`
          @media print {
            body * {
              visibility: hidden;
            }
            .print-area,
            .print-area * {
              visibility: visible;
            }
            .print-area {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
            }
            .barcode-label {
              page-break-inside: avoid;
            }
          }
        `}</style>
      </div>
    </ProtectedLayout>
  )
}

