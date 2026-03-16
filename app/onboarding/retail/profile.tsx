"use client"

import { useRouter } from "next/navigation"

interface RetailOnboardingProfileProps {
  business: any
  businessId: string
  onComplete: () => void
}

export default function RetailOnboardingProfile({
  business,
  businessId,
  onComplete
}: RetailOnboardingProfileProps) {
  const router = useRouter()

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
        Step 1: Complete Your Business Profile
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        Add your business logo, contact information, and basic details. This information will appear on all your receipts and documents.
      </p>
      <div className="flex gap-4">
        <button
          onClick={() => {
            router.push("/retail/settings/business-profile?return=/onboarding/retail")
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
        >
          Go to Business Profile
        </button>
        <button
          onClick={onComplete}
          className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium"
        >
          Skip for Now
        </button>
      </div>
    </div>
  )
}



















