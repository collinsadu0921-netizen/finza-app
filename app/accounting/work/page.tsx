import { Suspense } from "react"
import PracticeWorkPage from "@/components/practice/PracticeWorkPage"

export default function AccountingWorkPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <div className="h-7 w-7 animate-spin rounded-full border-b-2 border-blue-600" />
        </div>
      }
    >
      <PracticeWorkPage />
    </Suspense>
  )
}
