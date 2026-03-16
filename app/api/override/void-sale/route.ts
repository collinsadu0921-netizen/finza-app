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

    // Check that supervisor is not the same as cashier
    if (supervisorId === cashier_id) {
      return NextResponse.json(
        { error: "Cashier cannot override themselves." },
        { status: 403 }
      )
    }

    // Get sale to verify it exists and get business_id, store_id
    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .select("business_id, cashier_session_id, store_id")
      .eq("id", sale_id)
      .single()

    if (saleError || !sale) {
      return NextResponse.json(
        { error: "Sale not found" },
        { status: 404 }
      )
    }

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

    // AUTHORITY-BASED CHECK: Verify supervisor has sufficient authority for void override
    // Required authority: MANAGER (50) - Manager or Admin can approve voids
    const supervisorAuthority = getAuthorityLevel(supervisorRole as any)
    if (!hasAuthority(supervisorAuthority, REQUIRED_AUTHORITY.VOID)) {
      return NextResponse.json(
        { error: "Only supervisors (managers) and admins can approve void overrides." },
        { status: 403 }
      )
    }

    // Create override record
    const { error: overrideError } = await supabase.from("overrides").insert({
      action_type: "void_sale",
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

    // CRITICAL: Restore stock BEFORE deleting sale (need sale_items data)
    // Get service role client for stock movements (bypasses RLS)
    const getServiceRoleClient = () => {
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error("Service role key required for stock movements")
      }
      return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    }

    // Get sale items to restore stock
    const { data: saleItems, error: itemsError } = await supabase
      .from("sale_items")
      .select("product_id, variant_id, qty, name, store_id")
      .eq("sale_id", sale_id)

    if (!itemsError && saleItems && saleItems.length > 0) {
      for (const item of saleItems) {
        if (!item.product_id) continue

        // Get store_id from sale_item (inherited from sale) or from sale
        const itemStoreId = item.store_id || sale.store_id
        if (!itemStoreId) {
          console.error(`Warning: No store_id for void item ${item.product_id}. Stock restoration skipped.`)
          continue
        }

        // Get product to check track_stock flag
        const { data: product, error: productError } = await supabase
          .from("products")
          .select("track_stock, name")
          .eq("id", item.product_id)
          .single()

        if (productError || !product) {
          console.error(`Error fetching product ${item.product_id} for void:`, productError)
          continue
        }

        // Only restore stock if track_stock is true
        if (product.track_stock !== false) {
          const quantityReturned = Math.floor(Number(item.qty || 1))
          const variantId = item.variant_id || null

          // Handle variant stock restoration
          if (variantId) {
            // Restore variant stock in products_stock table
            const { data: variantStock, error: variantStockError } = await supabase
              .from("products_stock")
              .select("id, stock, stock_quantity")
              .eq("product_id", item.product_id)
              .eq("variant_id", variantId)
              .eq("store_id", itemStoreId)
              .maybeSingle()

            if (variantStockError) {
              console.error(`Error fetching variant stock for void:`, variantStockError)
              continue
            }

            if (variantStock) {
              // Update existing variant stock record
              const currentStock = Math.floor(
                variantStock.stock_quantity !== null && variantStock.stock_quantity !== undefined
                  ? Number(variantStock.stock_quantity)
                  : variantStock.stock !== null && variantStock.stock !== undefined
                    ? Number(variantStock.stock)
                    : 0
              )
              const newStock = Math.floor(currentStock + quantityReturned)

              const { error: stockUpdateError } = await supabase
                .from("products_stock")
                .update({
                  stock: newStock,
                  stock_quantity: newStock,
                })
                .eq("id", variantStock.id)

              if (stockUpdateError) {
                console.error(`Error restoring variant stock for void:`, stockUpdateError)
                continue
              }
            } else {
              // Create new variant stock record if it doesn't exist
              const { error: insertError } = await supabase
                .from("products_stock")
                .insert({
                  product_id: item.product_id,
                  variant_id: variantId,
                  store_id: itemStoreId,
                  stock: quantityReturned,
                  stock_quantity: quantityReturned,
                })

              if (insertError) {
                console.error(`Error creating variant stock record for void:`, insertError)
                continue
              }
            }
          } else {
            // Restore product stock (no variant) in products_stock table
            const { data: productStock, error: productStockError } = await supabase
              .from("products_stock")
              .select("id, stock, stock_quantity")
              .eq("product_id", item.product_id)
              .is("variant_id", null)
              .eq("store_id", itemStoreId)
              .maybeSingle()

            if (productStockError) {
              console.error(`Error fetching product stock for void:`, productStockError)
              continue
            }

            if (productStock) {
              // Update existing product stock record
              const currentStock = Math.floor(
                productStock.stock_quantity !== null && productStock.stock_quantity !== undefined
                  ? Number(productStock.stock_quantity)
                  : productStock.stock !== null && productStock.stock !== undefined
                    ? Number(productStock.stock)
                    : 0
              )
              const newStock = Math.floor(currentStock + quantityReturned)

              const { error: stockUpdateError } = await supabase
                .from("products_stock")
                .update({
                  stock: newStock,
                  stock_quantity: newStock,
                })
                .eq("id", productStock.id)

              if (stockUpdateError) {
                console.error(`Error restoring product stock for void:`, stockUpdateError)
                continue
              }
            } else {
              // Create new product stock record if it doesn't exist
              const { error: insertError } = await supabase
                .from("products_stock")
                .insert({
                  product_id: item.product_id,
                  variant_id: null,
                  store_id: itemStoreId,
                  stock: quantityReturned,
                  stock_quantity: quantityReturned,
                })

              if (insertError) {
                console.error(`Error creating product stock record for void:`, insertError)
                continue
              }
            }
          }

          // Create stock movement record for void (using service role client)
          try {
            const serviceRoleClient = getServiceRoleClient()
            const movementData: any = {
              business_id: sale.business_id,
              product_id: item.product_id,
              quantity_change: quantityReturned, // Positive for void (restoration)
              type: "adjustment", // Use adjustment type for void
              user_id: supervisorId, // Supervisor who approved the void
              related_sale_id: sale_id,
              note: `Void sale: ${item.name || product.name || "Product"} x${quantityReturned}`,
              store_id: itemStoreId,
            }

            if (variantId) {
              movementData.note = `Void sale (variant): ${item.name || product.name || "Product"} x${quantityReturned}`
            }

            const { error: movementError } = await serviceRoleClient
              .from("stock_movements")
              .insert(movementData)

            if (movementError) {
              console.error(`Error creating stock movement for void:`, movementError)
              // Don't fail the void if stock movement logging fails, but log it
            }
          } catch (serviceRoleError: any) {
            console.error(`Error getting service role client for void stock movement:`, serviceRoleError)
            // Continue - stock was restored, movement logging is secondary
          }
        }
      }
    }

    // STEP 3: POST VOID TO LEDGER (before deleting sale)
    // Every void MUST create a reversal journal entry. Failure to post aborts void.
    // NOTE: This happens BEFORE deletion so we can access sale data
    const getServiceRoleClient = () => {
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error("Service role key required for ledger operations")
      }
      return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      )
    }
    const serviceRoleClient = getServiceRoleClient()

    try {
      const { data: voidJournalEntryId, error: voidLedgerError } = await serviceRoleClient.rpc(
        "post_sale_void_to_ledger",
        {
          p_sale_id: sale_id,
        }
      )

      if (voidLedgerError) {
        console.error("Failed to post void to ledger:", voidLedgerError)
        return NextResponse.json(
          {
            error: `Failed to post void to ledger: ${voidLedgerError.message || "Ledger posting failed"}`,
            details: "Void was aborted due to ledger posting failure. Stock movements were created but sale was not deleted.",
          },
          { status: 500 }
        )
      }

      if (!voidJournalEntryId) {
        console.error("Void ledger posting returned no journal entry ID")
        return NextResponse.json(
          {
            error: "Failed to post void to ledger: No journal entry was created",
            details: "Void was aborted. Stock movements were created but sale was not deleted.",
          },
          { status: 500 }
        )
      }

      console.log("Void posted to ledger successfully:", {
        sale_id: sale_id,
        void_journal_entry_id: voidJournalEntryId,
      })
    } catch (voidLedgerException: any) {
      console.error("Exception while posting void to ledger:", voidLedgerException)
      return NextResponse.json(
        {
          error: `Failed to post void to ledger: ${voidLedgerException.message || "Unexpected error"}`,
          details: "Void was aborted due to ledger posting exception. Stock movements were created but sale was not deleted.",
        },
        { status: 500 }
      )
    }

    // STEP 4: Void the sale by deleting it (after ledger posting succeeds)
    const { error: deleteError } = await supabase
      .from("sales")
      .delete()
      .eq("id", sale_id)

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message || "Failed to void sale" },
        { status: 500 }
      )
    }

    // Also delete associated sale_items
    await supabase.from("sale_items").delete().eq("sale_id", sale_id)

    return NextResponse.json({
      success: true,
      message: "Sale voided successfully with supervisor approval",
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

