"use client"

import VoidSaleOverrideModal from "@/components/VoidSaleOverrideModal"

interface VoidSaleModalWrapperProps {
  showOverrideModal: boolean
  saleId: string | null
  cashierId: string | null
  onClose: () => void
  onSuccess: () => void
}

export default function VoidSaleModalWrapper({
  showOverrideModal,
  saleId,
  cashierId,
  onClose,
  onSuccess,
}: VoidSaleModalWrapperProps) {
  if (!showOverrideModal || !saleId || !cashierId) return null

  return (
    <VoidSaleOverrideModal
      isOpen={showOverrideModal}
      onClose={onClose}
      saleId={saleId}
      cashierId={cashierId}
      onSuccess={onSuccess}
    />
  )
}



