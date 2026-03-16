# Discount Override Protection - Integration Guide

This guide shows how to integrate supervisor override protection when applying discounts greater than 10% in Retail Mode.

## Components Created

1. **DiscountOverrideModal** - Modal component for supervisor authorization
2. **useDiscountOverride Hook** - React hook for easy integration
3. **API Route** - `/api/override/discount` - Handles override validation
4. **Utility Functions** - `lib/utils/discount.ts` - Discount calculation helpers

## Integration Example

### When Applying Discount to Entire Sale

```tsx
"use client"

import { useState } from "react"
import { useDiscountOverride } from "@/lib/hooks/useDiscountOverride"
import DiscountOverrideModalWrapper from "@/components/DiscountOverrideModalWrapper"
import { requiresDiscountOverride } from "@/lib/utils/discount"

export default function CheckoutPage() {
  const [discountPercent, setDiscountPercent] = useState(0)
  const [saleId, setSaleId] = useState<string | null>(null)
  const [overrideApproved, setOverrideApproved] = useState(false)

  const {
    requestDiscountOverride,
    showOverrideModal,
    saleId: overrideSaleId,
    cashierId,
    discountPercent: overrideDiscountPercent,
    handleOverrideClose,
    handleOverrideSuccess,
  } = useDiscountOverride({
    onSuccess: () => {
      setOverrideApproved(true)
      // Now you can apply the discount
      applyDiscount(discountPercent)
    },
    onError: (errorMsg) => {
      alert(errorMsg || "Supervisor approval required for discounts above 10%.")
    },
  })

  const handleDiscountChange = (percent: number) => {
    setDiscountPercent(percent)
    setOverrideApproved(false)
  }

  const applyDiscount = async (percent: number) => {
    if (!saleId) return

    // Check if override is required
    if (requiresDiscountOverride(percent)) {
      if (!overrideApproved) {
        // Request override
        await requestDiscountOverride(saleId, percent)
        return // Wait for override approval
      }
    }

    // Apply discount normally (≤10% or override approved)
    // Your existing discount application logic here
    console.log(`Applying ${percent}% discount to sale ${saleId}`)
  }

  return (
    <div>
      {/* Discount input */}
      <input
        type="number"
        value={discountPercent}
        onChange={(e) => handleDiscountChange(Number(e.target.value))}
        placeholder="Discount %"
      />

      <button onClick={() => applyDiscount(discountPercent)}>
        Apply Discount
      </button>

      {/* Render the override modal */}
      <DiscountOverrideModalWrapper
        showOverrideModal={showOverrideModal}
        saleId={overrideSaleId}
        cashierId={cashierId}
        discountPercent={overrideDiscountPercent}
        onClose={handleOverrideClose}
        onSuccess={handleOverrideSuccess}
      />
    </div>
  )
}
```

### When Applying Discount to Individual Item

```tsx
const applyItemDiscount = async (itemId: string, saleId: string, discountPercent: number) => {
  // Check threshold
  if (requiresDiscountOverride(discountPercent)) {
    // Request override before applying
    await requestDiscountOverride(saleId, discountPercent)
    // Wait for onSuccess callback, then apply discount
    return
  }

  // Apply discount normally if ≤10%
  // Your existing item discount logic
}
```

## Usage Pattern

1. **Before applying discount:**
   ```tsx
   if (requiresDiscountOverride(discountPercent)) {
     await requestDiscountOverride(saleId, discountPercent)
     // Wait for override approval
     return
   }
   ```

2. **After override approved:**
   - `onSuccess` callback is triggered
   - Apply the discount using existing logic
   - Discount is now approved and logged

3. **If override denied:**
   - `onError` callback is triggered
   - Show error: "Supervisor approval required for discounts above 10%."
   - Do NOT apply the discount

## Features

- ✅ Automatic threshold check (10%)
- ✅ Supervisor override modal for discounts > 10%
- ✅ Records override with `action_type = "discount_override"`
- ✅ Updates cashier session counters
- ✅ Prevents discount application without approval
- ✅ Error handling with clear messages

## Requirements Met

- ✅ Override protection for discounts > 10%
- ✅ Works for sale-level and item-level discounts
- ✅ Uses existing override modal pattern
- ✅ Records override in database
- ✅ Updates cashier session counters
- ✅ No changes to VAT or calculation logic
- ✅ Follows same structure as void/refund overrides



