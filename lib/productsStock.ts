/**
 * Products Stock Utilities
 * Helper functions to ensure products_stock rows exist for products and stores
 */

import { SupabaseClient } from "@supabase/supabase-js"

/**
 * Ensure products_stock row exists for a product in a store
 * If it doesn't exist, create it with stock = 0
 */
export async function ensureProductsStockRow(
  supabase: SupabaseClient,
  productId: string,
  storeId: string,
  variantId: string | null = null
): Promise<string | null> {
  try {
    // Check if row exists
    let query = supabase
      .from("products_stock")
      .select("id")
      .eq("product_id", productId)
      .eq("store_id", storeId)
    
    if (variantId) {
      query = query.eq("variant_id", variantId)
    } else {
      query = query.is("variant_id", null)
    }
    
    const { data: existing } = await query.maybeSingle()
    
    if (existing?.id) {
      return existing.id
    }
    
    // Create new row
    const { data: newRow, error } = await supabase
      .from("products_stock")
      .insert({
        product_id: productId,
        variant_id: variantId,
        store_id: storeId,
        stock: 0,
        stock_quantity: 0,
      })
      .select("id")
      .single()
    
    if (error) {
      console.error("Error creating products_stock row:", error)
      return null
    }
    
    return newRow?.id || null
  } catch (err) {
    console.error("Error ensuring products_stock row:", err)
    return null
  }
}

/**
 * Initialize products_stock rows for all products in a store
 * Useful when creating a new store or importing products
 */
export async function initializeStoreStock(
  supabase: SupabaseClient,
  businessId: string,
  storeId: string
): Promise<void> {
  try {
    // Get all products for this business
    const { data: products } = await supabase
      .from("products")
      .select("id")
      .eq("business_id", businessId)
    
    if (!products || products.length === 0) {
      return
    }
    
    // Get existing products_stock rows for this store
    const { data: existingStock } = await supabase
      .from("products_stock")
      .select("product_id, variant_id")
      .eq("store_id", storeId)
      .in("product_id", products.map((p) => p.id))
    
    const existingKeys = new Set(
      (existingStock || []).map((s) => `${s.product_id}-${s.variant_id || 'null'}`)
    )
    
    // Create missing rows
    const rowsToInsert = products
      .filter((p) => !existingKeys.has(`${p.id}-null`))
      .map((p) => ({
        product_id: p.id,
        variant_id: null,
        store_id: storeId,
        stock: 0,
        stock_quantity: 0,
      }))
    
    if (rowsToInsert.length > 0) {
      await supabase.from("products_stock").insert(rowsToInsert)
    }
    
    // Also initialize variant stock
    const { data: variants } = await supabase
      .from("products_variants")
      .select("id, product_id")
      .in("product_id", products.map((p) => p.id))
    
    if (variants && variants.length > 0) {
      const variantRowsToInsert = variants
        .filter((v) => !existingKeys.has(`${v.product_id}-${v.id}`))
        .map((v) => ({
          product_id: v.product_id,
          variant_id: v.id,
          store_id: storeId,
          stock: 0,
          stock_quantity: 0,
        }))
      
      if (variantRowsToInsert.length > 0) {
        await supabase.from("products_stock").insert(variantRowsToInsert)
      }
    }
  } catch (err) {
    console.error("Error initializing store stock:", err)
  }
}







