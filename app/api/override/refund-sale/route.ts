import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getAuthorityLevel, hasAuthority, REQUIRED_AUTHORITY } from "@/lib/authority"

// Service role client for database operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Anon client for authentication (signInWithPassword requires anon key)
const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { supervisor_email, supervisor_password, sale_id, cashier_id } = body

    if (!supervisor_email || !supervisor_password || !sale_id || !cashier_id) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Verify supervisor credentials using Supabase Auth
    const authResponse = await supabaseAnon.auth.signInWithPassword({
      email: supervisor_email,
      password: supervisor_password,
    })

    if (authResponse.error || !authResponse.data.user) {
      return NextResponse.json(
        { error: "Invalid supervisor authorization." },
        { status: 401 }
      )
    }

    const supervisorId = authResponse.data.user.id

    // Get service role client for all database operations (bypasses RLS)
    const getServiceRoleClient = () => {
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error("Service role key required for stock operations")
      }
      return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    }
    const serviceRoleClient = getServiceRoleClient()

    // Get sale to verify it exists and get business_id
    // Use service role client to ensure we can read the sale even if RLS blocks it
    const { data: sale, error: saleError } = await serviceRoleClient
      .from("sales")
      .select("business_id, cashier_session_id, payment_status, store_id")
      .eq("id", sale_id)
      .single()

    if (saleError || !sale) {
      return NextResponse.json(
        { error: "Sale not found" },
        { status: 404 }
      )
    }

    // Check if sale is already refunded - CRITICAL: prevent double processing
    if (sale.payment_status === "refunded") {
      console.log(`[REFUND] Sale ${sale_id} is already refunded. Skipping stock restoration to prevent double processing.`)
      return NextResponse.json(
        { error: "Sale is already refunded" },
        { status: 400 }
      )
    }
    
    console.log(`[REFUND] Processing refund for sale ${sale_id}, current status: ${sale.payment_status}`)

    // Check if supervisor is the business owner
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("owner_id")
      .eq("id", sale.business_id)
      .single()

    const isBusinessOwner = business && business.owner_id === supervisorId

    // Check supervisor role in business_users table (if not owner)
    let supervisorRole: string | null = null
    if (!isBusinessOwner) {
      const { data: businessUser, error: roleError } = await supabase
        .from("business_users")
        .select("role")
        .eq("business_id", sale.business_id)
        .eq("user_id", supervisorId)
        .maybeSingle()

      if (roleError || !businessUser) {
        return NextResponse.json(
          { error: "Invalid supervisor authorization. You must be an owner, admin, or manager." },
          { status: 403 }
        )
      }
      supervisorRole = businessUser.role
    } else {
      supervisorRole = "owner"
    }

    // AUTHORITY-BASED CHECK: Verify supervisor has sufficient authority for refund override
    // Required authority: MANAGER (50) - Manager or Admin can approve refunds
    const supervisorAuthority = getAuthorityLevel(supervisorRole as any)
    if (!hasAuthority(supervisorAuthority, REQUIRED_AUTHORITY.REFUND)) {
      return NextResponse.json(
        { error: "Only supervisors (managers) and admins can approve refund overrides." },
        { status: 403 }
      )
    }

    // ROLE-AWARE SELF-OVERRIDE CHECK: Block self-override only for cashiers/employees (authority < 50)
    // Admin/manager/owner may approve refunds they initiated (self-override allowed)
    if (supervisorId === cashier_id) {
      // Only block if supervisor has insufficient authority (cashier/employee level)
      if (supervisorAuthority < REQUIRED_AUTHORITY.REFUND) {
        return NextResponse.json(
          { error: "Cashier cannot override themselves." },
          { status: 403 }
        )
      }
      // Admin/manager/owner self-override is allowed - continue processing
    }

    // Create override record
    const { error: overrideError } = await supabase.from("overrides").insert({
      action_type: "refund_sale",
      reference_id: sale_id,
      cashier_id: cashier_id,
      supervisor_id: supervisorId,
    })

    if (overrideError) {
      return NextResponse.json(
        { error: overrideError.message || "Failed to record override" },
        { status: 500 }
      )
    }

    // Update supervised_actions_count in cashier_sessions if session exists
    if (sale.cashier_session_id) {
      // Get current count
      const { data: session, error: sessionError } = await supabase
        .from("cashier_sessions")
        .select("supervised_actions_count")
        .eq("id", sale.cashier_session_id)
        .single()

      if (!sessionError && session) {
        const currentCount = session.supervised_actions_count || 0
        await supabase
          .from("cashier_sessions")
          .update({
            supervised_actions_count: currentCount + 1,
          })
          .eq("id", sale.cashier_session_id)
      }
    }

    // Restore stock for each item in the refunded sale
    // CRITICAL: Use products_stock table (per-store inventory) not products table
    // Use service role client to bypass RLS
    const { data: saleItems, error: itemsError } = await serviceRoleClient
      .from("sale_items")
      .select("product_id, variant_id, qty, name")
      .eq("sale_id", sale_id)

    // HARD ASSERTION: Sale must have items
    if (itemsError) {
      return NextResponse.json(
        { error: `Failed to fetch sale items: ${itemsError.message}` },
        { status: 500 }
      )
    }

    if (!saleItems || saleItems.length === 0) {
      return NextResponse.json(
        { error: "Cannot refund sale: Sale has no items" },
        { status: 400 }
      )
    }

    // HARD ASSERTION: Store ID must exist
    if (!sale.store_id) {
      return NextResponse.json(
        { error: "Cannot refund sale: Sale has no store_id" },
        { status: 400 }
      )
    }

    const itemStoreId = sale.store_id
    const stockRestorationErrors: string[] = []
    const stockMovementInserts: Array<{ product_id: string; quantity: number }> = []

    // STEP 1: INSERT STOCK MOVEMENTS FIRST (before updating products_stock)
    // This ensures audit trail exists even if stock update fails
    for (const item of saleItems) {
      if (!item.product_id) {
        stockRestorationErrors.push(`Sale item missing product_id`)
        continue
      }

      // Get product to check track_stock flag
      const { data: product, error: productError } = await serviceRoleClient
        .from("products")
        .select("track_stock, name")
        .eq("id", item.product_id)
        .single()

      if (productError || !product) {
        const errorMsg = `Error fetching product ${item.product_id} for refund: ${productError?.message || "Product not found"}`
        stockRestorationErrors.push(errorMsg)
        continue
      }

      // Only create movement if track_stock is true
      if (product.track_stock !== false) {
        const quantityReturned = Math.abs(Math.floor(Number(item.qty || 1)))
        const variantId = item.variant_id || null

        // CRITICAL: Insert stock movement BEFORE updating products_stock
        // NO try/catch - if this fails, refund MUST fail
        const movementData: any = {
          business_id: sale.business_id,
          product_id: item.product_id,
          quantity_change: quantityReturned, // Positive for refund
          type: "refund",
          user_id: supervisorId,
          related_sale_id: sale_id,
          note: variantId 
            ? `Refund (variant): ${item.name || product.name || "Product"} x${quantityReturned}`
            : `Refund: ${item.name || product.name || "Product"} x${quantityReturned}`,
          store_id: itemStoreId,
        }

        const { error: movementError } = await serviceRoleClient
          .from("stock_movements")
          .insert(movementData)

        if (movementError) {
          const errorMsg = `CRITICAL: Failed to create refund stock movement for product ${item.product_id}: ${movementError.message}`
          console.error(`[REFUND] ${errorMsg}`)
          stockRestorationErrors.push(errorMsg)
          continue
        }

        stockMovementInserts.push({ product_id: item.product_id, quantity: quantityReturned })
        console.log(`[REFUND] Created refund stock movement for product ${item.product_id}, quantity: ${quantityReturned}`)
      }
    }

    // HARD ASSERTION: All stock movements must be created
    if (stockRestorationErrors.length > 0) {
      return NextResponse.json({
        success: false,
        error: "Refund failed: Could not create stock movements",
        details: stockRestorationErrors,
        message: "Refund cannot complete without stock movement audit trail.",
      }, { status: 500 })
    }

    // STEP 2: UPDATE products_stock (after movements are created)
    for (const item of saleItems) {
      if (!item.product_id) continue

      console.log(`[REFUND] Processing stock restoration for product ${item.product_id}, store ${itemStoreId}`)

      // Get product to check track_stock flag
      const { data: product, error: productError } = await serviceRoleClient
        .from("products")
        .select("track_stock, name")
        .eq("id", item.product_id)
        .single()

      if (productError || !product) {
        const errorMsg = `Error fetching product ${item.product_id} for refund: ${productError?.message || "Product not found"}`
        console.error(errorMsg)
        stockRestorationErrors.push(errorMsg)
        continue
      }

      // Only restore stock if track_stock is true
      if (product.track_stock !== false) {
        const quantityReturned = Math.abs(Math.floor(Number(item.qty || 1)))
        const variantId = item.variant_id || null
        
        console.log(`[REFUND] Restoring stock for product ${item.product_id}, variant ${variantId || 'none'}, store ${itemStoreId}, quantity: ${quantityReturned}`)

          // Handle variant stock restoration
          if (variantId) {
            // Restore variant stock in products_stock table
            // Use service role client to bypass RLS
            let { data: variantStock, error: variantStockError } = await serviceRoleClient
              .from("products_stock")
              .select("id, stock, stock_quantity")
              .eq("product_id", item.product_id)
              .eq("variant_id", variantId)
              .eq("store_id", itemStoreId)
              .maybeSingle()

            if (variantStockError) {
              const errorMsg = `Error fetching variant stock for refund (product ${item.product_id}, variant ${variantId}, store ${itemStoreId}): ${variantStockError.message}`
              console.error(errorMsg)
              stockRestorationErrors.push(errorMsg)
              continue
            }

            // REFUND STOCK FIX: Ensure stock record exists before updating
            // If record doesn't exist, create it first, then update it
            if (!variantStock) {
              // Create stock record if it doesn't exist
              const { data: newVariantStock, error: insertError } = await serviceRoleClient
                .from("products_stock")
                .insert({
                  product_id: item.product_id,
                  variant_id: variantId,
                  store_id: itemStoreId,
                  stock: 0,
                  stock_quantity: 0,
                })
                .select("id, stock, stock_quantity")
                .single()

              if (insertError || !newVariantStock) {
                const errorMsg = `Cannot restore stock: Failed to create variant stock record for refund (product ${item.product_id}, variant ${variantId}, store ${itemStoreId}): ${insertError?.message || "Unknown error"}`
                console.error(`[REFUND] ${errorMsg}`)
                stockRestorationErrors.push(errorMsg)
                continue
              }
              
              // Use the newly created record
              variantStock = newVariantStock
            }

            // Update existing or newly created variant stock record
            const currentStock = Math.floor(
              variantStock.stock_quantity !== null && variantStock.stock_quantity !== undefined
                ? Number(variantStock.stock_quantity)
                : variantStock.stock !== null && variantStock.stock !== undefined
                  ? Number(variantStock.stock)
                  : 0
            )
            const newStock = Math.floor(currentStock + quantityReturned) // ADD stock (restore)
            
            console.log(`[REFUND] Variant stock: current=${currentStock}, adding=${quantityReturned}, new=${newStock}`)

            // Use service role client to bypass RLS
            const { error: stockUpdateError } = await serviceRoleClient
              .from("products_stock")
              .update({
                stock: newStock,
                stock_quantity: newStock,
              })
              .eq("id", variantStock.id)

            if (stockUpdateError) {
              const errorMsg = `Cannot restore stock: Error updating variant stock for refund: ${stockUpdateError.message}`
              console.error(`[REFUND] ${errorMsg}`)
              stockRestorationErrors.push(errorMsg)
              continue
            }
            
            // VERIFY: Confirm stock was actually updated
            const { data: verifyStock, error: verifyError } = await serviceRoleClient
              .from("products_stock")
              .select("id, stock, stock_quantity")
              .eq("id", variantStock.id)
              .single()
            
            if (verifyError || !verifyStock) {
              const errorMsg = `Cannot verify stock restoration: Failed to read back variant stock after update`
              console.error(`[REFUND] ${errorMsg}`, verifyError)
              stockRestorationErrors.push(errorMsg)
              continue
            }
            
            const verifiedStock = Math.floor(
              verifyStock.stock_quantity !== null && verifyStock.stock_quantity !== undefined
                ? Number(verifyStock.stock_quantity)
                : verifyStock.stock !== null && verifyStock.stock !== undefined
                  ? Number(verifyStock.stock)
                  : 0
            )
            
            if (verifiedStock !== newStock) {
              const errorMsg = `Stock verification failed: Expected ${newStock}, but database shows ${verifiedStock} for variant ${variantId}`
              console.error(`[REFUND] ${errorMsg}`)
              stockRestorationErrors.push(errorMsg)
              continue
            }
            
            console.log(`[REFUND] Successfully restored variant stock: ${variantStock.id}, verified stock: ${verifiedStock}`)
          } else {
            // Restore product stock (no variant) in products_stock table
            // Use service role client to bypass RLS
            let { data: productStock, error: productStockError } = await serviceRoleClient
              .from("products_stock")
              .select("id, stock, stock_quantity")
              .eq("product_id", item.product_id)
              .is("variant_id", null)
              .eq("store_id", itemStoreId)
              .maybeSingle()

            if (productStockError) {
              const errorMsg = `Error fetching product stock for refund (product ${item.product_id}, store ${itemStoreId}): ${productStockError.message}`
              console.error(errorMsg)
              stockRestorationErrors.push(errorMsg)
              continue
            }

            // REFUND STOCK FIX: Ensure stock record exists before updating
            // If record doesn't exist, create it first, then update it
            if (!productStock) {
              // Create stock record if it doesn't exist
              const { data: newProductStock, error: insertError } = await serviceRoleClient
                .from("products_stock")
                .insert({
                  product_id: item.product_id,
                  variant_id: null,
                  store_id: itemStoreId,
                  stock: 0,
                  stock_quantity: 0,
                })
                .select("id, stock, stock_quantity")
                .single()

              if (insertError || !newProductStock) {
                const errorMsg = `Cannot restore stock: Failed to create product stock record for refund (product ${item.product_id}, store ${itemStoreId}): ${insertError?.message || "Unknown error"}`
                console.error(`[REFUND] ${errorMsg}`)
                stockRestorationErrors.push(errorMsg)
                continue
              }
              
              // Use the newly created record
              productStock = newProductStock
            }

            // Update existing or newly created product stock record
            const currentStock = Math.floor(
              productStock.stock_quantity !== null && productStock.stock_quantity !== undefined
                ? Number(productStock.stock_quantity)
                : productStock.stock !== null && productStock.stock !== undefined
                  ? Number(productStock.stock)
                  : 0
            )
            const newStock = Math.floor(currentStock + quantityReturned) // ADD stock (restore)
            
            console.log(`[REFUND] Product stock: current=${currentStock}, adding=${quantityReturned}, new=${newStock}`)

            // Use service role client to bypass RLS
            const { error: stockUpdateError } = await serviceRoleClient
              .from("products_stock")
              .update({
                stock: newStock,
                stock_quantity: newStock,
              })
              .eq("id", productStock.id)

            if (stockUpdateError) {
              const errorMsg = `Cannot restore stock: Error updating product stock for refund: ${stockUpdateError.message}`
              console.error(`[REFUND] ${errorMsg}`)
              stockRestorationErrors.push(errorMsg)
              continue
            }
            
            // VERIFY: Confirm stock was actually updated
            const { data: verifyStock, error: verifyError } = await serviceRoleClient
              .from("products_stock")
              .select("id, stock, stock_quantity")
              .eq("id", productStock.id)
              .single()
            
            if (verifyError || !verifyStock) {
              const errorMsg = `Cannot verify stock restoration: Failed to read back product stock after update`
              console.error(`[REFUND] ${errorMsg}`, verifyError)
              stockRestorationErrors.push(errorMsg)
              continue
            }
            
            const verifiedStock = Math.floor(
              verifyStock.stock_quantity !== null && verifyStock.stock_quantity !== undefined
                ? Number(verifyStock.stock_quantity)
                : verifyStock.stock !== null && verifyStock.stock !== undefined
                  ? Number(verifyStock.stock)
                  : 0
            )
            
            if (verifiedStock !== newStock) {
              const errorMsg = `Stock verification failed: Expected ${newStock}, but database shows ${verifiedStock} for product ${item.product_id}`
              console.error(`[REFUND] ${errorMsg}`)
              stockRestorationErrors.push(errorMsg)
              continue
            }
            
            console.log(`[REFUND] Successfully restored product stock: ${productStock.id}, verified stock: ${verifiedStock}`)
          }
        }
      }

    // HARD ASSERTION: Stock restoration must succeed
    if (stockRestorationErrors.length > 0) {
      console.error(`[REFUND] Stock restoration failed with ${stockRestorationErrors.length} errors:`, stockRestorationErrors)
      return NextResponse.json({
        success: false,
        error: "Refund failed: Stock could not be restored",
        details: stockRestorationErrors,
        message: "Refund cannot complete without stock restoration. Please check errors and try again.",
      }, { status: 500 })
    }

    // STEP 3: UPDATE sales.payment_status (BEFORE ledger posting - required for refund posting function)
    // CRITICAL: Preserve store_id - never modify it during refund
    const updateData: any = {
      payment_status: "refunded",
    }

    // Preserve store_id if it exists (never set to null or modify it)
    if (sale.store_id) {
      updateData.store_id = sale.store_id
    }

    // Use service role client to update sale status
    const { error: updateError } = await serviceRoleClient
      .from("sales")
      .update(updateData)
      .eq("id", sale_id)

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message || "Failed to process refund" },
        { status: 500 }
      )
    }

    // STEP 4: POST REFUND TO LEDGER (PHASE A1 - Completeness Invariant)
    // Every refund MUST create a reversal journal entry. Failure to post aborts refund.
    // NOTE: This happens AFTER payment_status is updated so refund posting function can validate
    try {
      const { data: refundJournalEntryId, error: refundLedgerError } = await serviceRoleClient.rpc(
        "post_sale_refund_to_ledger",
        {
          p_sale_id: sale_id,
        }
      )

      if (refundLedgerError) {
        console.error("Failed to post refund to ledger:", refundLedgerError)
        // Rollback: Revert payment_status if ledger posting fails
        // NOTE: Stock restoration and movements are already committed - cannot rollback
        // This is acceptable as stock restoration is operational, not ledger-dependent
        await serviceRoleClient
          .from("sales")
          .update({
            payment_status: sale.payment_status, // Restore original status
            store_id: sale.store_id, // Preserve store_id
          })
          .eq("id", sale_id)
        
        return NextResponse.json(
          {
            error: `Failed to post refund to ledger: ${refundLedgerError.message || "Ledger posting failed"}`,
            details: "Refund was rolled back due to ledger posting failure. Stock movements were created but sale status was not updated.",
          },
          { status: 500 }
        )
      }

      if (!refundJournalEntryId) {
        console.error("Refund ledger posting returned no journal entry ID")
        // Rollback: Revert payment_status if no journal entry was created
        await serviceRoleClient
          .from("sales")
          .update({
            payment_status: sale.payment_status, // Restore original status
            store_id: sale.store_id, // Preserve store_id
          })
          .eq("id", sale_id)
        
        return NextResponse.json(
          {
            error: "Failed to post refund to ledger: No journal entry was created",
            details: "Refund was rolled back. Stock movements were created but sale status was not updated.",
          },
          { status: 500 }
        )
      }

      console.log("Refund posted to ledger successfully:", {
        sale_id: sale_id,
        refund_journal_entry_id: refundJournalEntryId,
      })
    } catch (refundLedgerException: any) {
      console.error("Exception while posting refund to ledger:", refundLedgerException)
      // Rollback: Revert payment_status if ledger posting throws an exception
      await serviceRoleClient
        .from("sales")
        .update({
          payment_status: sale.payment_status, // Restore original status
          store_id: sale.store_id, // Preserve store_id
        })
        .eq("id", sale_id)
      
      return NextResponse.json(
        {
          error: `Failed to post refund to ledger: ${refundLedgerException.message || "Unexpected error"}`,
          details: "Refund was rolled back due to ledger posting exception. Stock movements were created but sale status was not updated.",
        },
        { status: 500 }
      )
    }

    // VALIDATION: Verify refund movements were created
    const { data: refundMovements, error: verifyMovementError } = await serviceRoleClient
      .from("stock_movements")
      .select("id")
      .eq("related_sale_id", sale_id)
      .eq("type", "refund")

    if (verifyMovementError) {
      console.error(`[REFUND] Warning: Could not verify refund movements: ${verifyMovementError.message}`)
    } else {
      const movementCount = refundMovements?.length || 0
      const expectedCount = stockMovementInserts.length
      if (movementCount !== expectedCount) {
        console.error(`[REFUND] CRITICAL: Refund movement count mismatch. Expected ${expectedCount}, found ${movementCount}`)
        // This is a data integrity issue, but refund already processed
        // Log for investigation but don't fail the refund
      } else {
        console.log(`[REFUND] Verified ${movementCount} refund stock movements created`)
      }
    }
    
    console.log(`[REFUND] Stock restoration completed successfully for sale ${sale_id}, store ${sale.store_id}`)

    return NextResponse.json({
      success: true,
      message: "Refund processed successfully with supervisor approval",
      store_id: sale.store_id, // Include store_id so client knows which store's inventory was updated
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

