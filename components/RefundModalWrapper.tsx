"use client"

import RefundOverrideModal from "@/components/RefundOverrideModal"

interface RefundModalWrapperProps {
  showOverrideModal: boolean
  saleId: string | null
  cashierId: string | null
  onClose: () => void
  onSuccess: () => void
}

export default function RefundModalWrapper({
  showOverrideModal,
  saleId,
  cashierId,
  onClose,
  onSuccess,
}: RefundModalWrapperProps) {
  if (!showOverrideModal || !saleId || !cashierId) return null

  return (
    <RefundOverrideModal
      isOpen={showOverrideModal}
      onClose={onClose}
      saleId={saleId}
      cashierId={cashierId}
      onSuccess={onSuccess}
    />
  )
}

