"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { ensureTabIndustryMode } from "@/lib/industryMode"
import RetailOnboardingProfile from "./profile"
import RetailOnboardingStore from "./store"
import RetailOnboardingProducts from "./products"
import RetailOnboardingRegister from "./register"
import RetailOnboardingCompleted from "./completed"
import { useToast } from "@/components/ui/ToastProvider"
import OnboardingAIAssistant from "@/components/onboarding/OnboardingAIAssistant"

type RetailOnboardingStep = 
  | "business_profile"
  | "create_store"
  | "add_products"
  | "open_register"
  | "start_pos"
  | "complete"

export default function RetailOnboardingPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [currentStep, setCurrentStep] = useState<RetailOnboardingStep>("business_profile")
  const [business, setBusiness] = useState<any>(null)
  const [businessId, setBusinessId] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    loadBusiness()
  }, [])

  // Handle redirect when onboarding is complete
  useEffect(() => {
    if (!loading && currentStep === "complete") {
      router.push("/pos")
    }
  }, [currentStep, loading, router])

  const loadBusiness = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/login")
        return
      }

      // Step 9.3 Fix: Check signup intent before redirecting
      const signupIntent = user.user_metadata?.signup_intent || "business_owner"
      
      const businessData = await getCurrentBusiness(supabase, user.id)
      if (!businessData) {
        // If accounting firm user, redirect to firm setup instead
        if (signupIntent === "accounting_firm") {
          const { data: firmUsers } = await supabase
            .from("accounting_firm_users")
            .select("firm_id")
            .eq("user_id", user.id)
            .limit(1)

          if (firmUsers && firmUsers.length > 0) {
            router.push("/accounting/firm")
            return
          } else {
            router.push("/accounting/firm/setup")
            return
          }
        }
        
        // Default: business owner needs a business
        router.push("/business-setup")
        return
      }

      // Only allow retail businesses here
      if (businessData.industry !== "retail") {
        router.push("/onboarding")
        return
      }

      setBusiness(businessData)
      setBusinessId(businessData.id)

      // Initialize industry mode
      ensureTabIndustryMode(businessData.industry)

      // Load onboarding step from business
      // ONBOARDING FIX: Do NOT default to "business_profile" - this causes silent resets
      // If onboarding_step is missing/invalid, log error and show error state instead
      const step = businessData.onboarding_step
      if (!step || step === "") {
        console.error("Missing onboarding_step for business:", businessData.id)
        setError("Onboarding state is missing. Please contact support.")
        setLoading(false)
        return
      }
      
      // Map generic steps to retail-specific steps
      const retailStep = mapToRetailStep(step)
      if (!retailStep) {
        // Invalid step that doesn't map to any valid retail step
        console.error("Invalid onboarding_step for retail business:", step, "for business:", businessData.id)
        setError("Onboarding state is invalid. Please contact support.")
        setLoading(false)
        return
      }
      setCurrentStep(retailStep)

      setLoading(false)
    } catch (err) {
      console.error("Error loading business:", err)
      setLoading(false)
    }
  }

  const mapToRetailStep = (step: string): RetailOnboardingStep | null => {
    // Map generic onboarding steps to retail-specific steps
    // ONBOARDING FIX: Return null for invalid steps instead of defaulting
    const stepMap: Record<string, RetailOnboardingStep> = {
      "business_profile": "business_profile",
      "create_store": "create_store",
      "add_products": "add_products",
      "add_product": "add_products", // Generic step maps to retail step
      "open_register": "open_register",
      "start_pos": "start_pos",
      "complete": "complete"
    }
    return stepMap[step] || null
  }

  const updateOnboardingStep = async (step: RetailOnboardingStep) => {
    try {
      const { error } = await supabase
        .from("businesses")
        .update({ onboarding_step: step })
        .eq("id", businessId)

      if (error) {
        console.error("Error updating onboarding step:", error)
        return
      }

      setCurrentStep(step)
    } catch (err) {
      console.error("Error updating onboarding step:", err)
    }
  }

  const getStepNumber = (step: RetailOnboardingStep): number => {
    const stepOrder: RetailOnboardingStep[] = [
      "business_profile",
      "create_store",
      "add_products",
      "open_register",
      "start_pos"
    ]
    return stepOrder.indexOf(step) + 1
  }

  const getStepLabel = (step: RetailOnboardingStep): string => {
    const labels: Record<RetailOnboardingStep, string> = {
      "business_profile": "Business Profile",
      "create_store": "Create Store",
      "add_products": "Add Products",
      "open_register": "Open Register Session",
      "start_pos": "Start POS",
      "complete": "Complete"
    }
    return labels[step] || "Unknown"
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="flex items-center justify-center h-screen">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  // Show error if onboarding state is invalid
  if (error) {
    return (
      <ProtectedLayout>
        <div className="flex items-center justify-center h-screen">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 max-w-md">
            <h2 className="text-xl font-bold text-red-600 dark:text-red-400 mb-4">Onboarding Error</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">{error}</p>
            <button
              onClick={() => router.push("/retail/dashboard")}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  // If onboarding is complete, show redirecting message
  if (currentStep === "complete") {
    return (
      <ProtectedLayout>
        <div className="flex items-center justify-center h-screen">
          <p>Redirecting to POS...</p>
        </div>
      </ProtectedLayout>
    )
  }

  const currentStepNumber = getStepNumber(currentStep)
  const totalSteps = 5

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              Welcome to Finza Retail!
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Let's get your retail business set up in just a few steps
            </p>
          </div>

          {/* Progress Steps */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              {[
                "business_profile",
                "create_store",
                "add_products",
                "open_register",
                "start_pos"
              ].map((step, index) => {
                const stepKey = step as RetailOnboardingStep
                const isActive = stepKey === currentStep
                const isCompleted = index < currentStepNumber - 1
                return (
                  <div key={step} className="flex items-center flex-1">
                    <div className="flex flex-col items-center flex-1">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                          isActive
                            ? "bg-blue-600 text-white"
                            : isCompleted
                            ? "bg-green-600 text-white"
                            : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                        }`}
                      >
                        {isCompleted ? "✓" : index + 1}
                      </div>
                      <p
                        className={`mt-2 text-xs text-center ${
                          isActive
                            ? "text-blue-600 dark:text-blue-400 font-semibold"
                            : isCompleted
                            ? "text-green-600 dark:text-green-400"
                            : "text-gray-500 dark:text-gray-400"
                        }`}
                      >
                        {getStepLabel(stepKey)}
                      </p>
                    </div>
                    {index < 4 && (
                      <div
                        className={`h-1 flex-1 mx-2 ${
                          isCompleted ? "bg-green-600" : "bg-gray-200 dark:bg-gray-700"
                        }`}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Current Step Content */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 mb-6">
            {currentStep === "business_profile" && (
              <RetailOnboardingProfile
                business={business}
                businessId={businessId}
                onComplete={() => updateOnboardingStep("create_store")}
              />
            )}

            {currentStep === "create_store" && (
              <RetailOnboardingStore
                business={business}
                businessId={businessId}
                onComplete={() => updateOnboardingStep("add_products")}
              />
            )}

            {currentStep === "add_products" && (
              <RetailOnboardingProducts
                business={business}
                businessId={businessId}
                onComplete={() => updateOnboardingStep("open_register")}
              />
            )}

            {currentStep === "open_register" && (
              <RetailOnboardingRegister
                business={business}
                businessId={businessId}
                onComplete={() => updateOnboardingStep("start_pos")}
              />
            )}

            {currentStep === "start_pos" && (
              <RetailOnboardingCompleted
                business={business}
                businessId={businessId}
                onComplete={() => updateOnboardingStep("complete")}
              />
            )}
          </div>

          <div className="mb-6">
            <OnboardingAIAssistant step={currentStep} />
          </div>

          {/* Skip All Button */}
          <div className="text-center">
            <button
              onClick={async () => {
                // VALIDATION: business.name must exist before onboarding can be skipped/completed
                if (!business?.name || business.name.trim() === "") {
                  console.error("Cannot skip onboarding: business.name is missing or empty")
                  toast.showToast("Cannot complete onboarding: Business name is required. Please complete your business profile first.", "warning")
                  return
                }
                await updateOnboardingStep("complete")
                router.push("/pos")
              }}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm underline"
            >
              Skip onboarding and go to POS
            </button>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}













