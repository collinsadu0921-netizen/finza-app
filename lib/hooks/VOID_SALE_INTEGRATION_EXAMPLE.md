# Void Sale with Supervisor Override - Integration Guide

This guide shows how to integrate supervisor override protection when voiding sales in Retail Mode.

## Components Created

1. **VoidSaleOverrideModal** - Modal component for supervisor authorization
2. **useVoidSale Hook** - React hook for easy integration
3. **API Route** - `/api/override/void-sale` - Handles override validation and sale voiding

## Integration Example

### In POS Cart View or Sale Details Screen

```tsx
"use client"

import { useVoidSale } from "@/lib/hooks/useVoidSale"

export default function POSCartView() {
  const { requestVoidSale, VoidSaleModal, error } = useVoidSale({
    onSuccess: () => {
      // Refresh cart/sales list
      // Show success message
      console.log("Sale voided successfully")
    },
    onError: (errorMsg) => {
      // Show error message
      console.error(errorMsg)
    },
  })

  const handleVoidSale = (saleId: string) => {
    // This will automatically show the override modal
    requestVoidSale(saleId)
  }

  return (
    <div>
      {/* Your POS UI here */}
      
      {/* Example: Void button in sale details */}
      <button
        onClick={() => handleVoidSale(sale.id)}
        className="bg-red-600 text-white px-4 py-2 rounded"
      >
        Void Sale
      </button>

      {/* Render the override modal */}
      <VoidSaleModal />

      {/* Show error if any */}
      {error && <div className="text-red-600">{error}</div>}
    </div>
  )
}
```

## Features

- ✅ Automatic supervisor override modal when void is requested
- ✅ Validates supervisor credentials (fresh password check)
- ✅ Checks supervisor role (owner/admin only)
- ✅ Prevents cashier from overriding themselves
- ✅ Records override in `overrides` table
- ✅ Updates `supervised_actions_count` in `cashier_sessions`
- ✅ Deletes sale and associated `sale_items`
- ✅ Shows error if override is denied

## Requirements Met

- ✅ Supervisor override protection for void sale
- ✅ Uses existing override modal pattern
- ✅ Records override with `action_type = "void_sale"`
- ✅ Updates cashier session counters
- ✅ No new UI pages created
- ✅ Maintains existing POS behaviors



