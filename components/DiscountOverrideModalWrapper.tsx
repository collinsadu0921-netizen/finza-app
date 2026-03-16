"use client"

import DiscountOverrideModal from "@/components/DiscountOverrideModal"

interface DiscountOverrideModalWrapperProps {
  showOverrideModal: boolean
  saleId: string | null
  cashierId: string | null
  discountPercent: number | null
  onClose: () => void
  onSuccess: () => void
}

export default function DiscountOverrideModalWrapper({
  showOverrideModal,
  saleId,
  cashierId,
  discountPercent,
  onClose,
  onSuccess,
}: DiscountOverrideModalWrapperProps) {
  if (!showOverrideModal || !saleId || !cashierId || discountPercent === null) {
    return null
  }

  return (
    <DiscountOverrideModal
      isOpen={showOverrideModal}
      onClose={onClose}
      saleId={saleId}
      cashierId={cashierId}
      discountPercent={discountPercent}
      onSuccess={onSuccess}
    />
  )
}



