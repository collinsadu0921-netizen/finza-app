"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { ensureTabIndustryMode } from "@/lib/industryMode"
import { useToast } from "@/components/ui/ToastProvider"
import OnboardingAIAssistant from "@/components/onboarding/OnboardingAIAssistant"

type OnboardingStep =
  | "business_profile"
  | "industry_confirmation"
  | "tax_awareness"
  | "payment_channels"
  | "communication_channels"
  | "accounting_readiness"
  | "add_customer"
  | "add_product"
  | "create_invoice"
  | "open_register"
  | "start_pos"
  | "add_rider"
  | "setup_pricing"
  | "start_deliveries"
  | "complete"

export default function OnboardingPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("business_profile")
  const [business, setBusiness] = useState<any>(null)
  const [businessId, setBusinessId] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    loadBusiness()
  }, [])

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

      setBusiness(businessData)
      setBusinessId(businessData.id)

      // Initialize industry mode
      ensureTabIndustryMode(businessData.industry)

      // CRITICAL: Redirect retail users to retail-specific onboarding
      if (businessData.industry === "retail") {
        router.push("/onboarding/retail")
        return
      }

      // Load onboarding step from business
      // ONBOARDING FIX: Do NOT default to "business_profile" - this causes silent resets
      // If onboarding_step is missing/invalid, log error and show error state instead
      const step = businessData.onboarding_step
      const validSteps = ["business_profile", "industry_confirmation", "tax_awareness", "payment_channels", "communication_channels", "accounting_readiness", "add_customer", "add_product", "create_invoice", "open_register", "start_pos", "add_rider", "setup_pricing", "start_deliveries", "complete"]
      if (!step || step === "" || !validSteps.includes(step)) {
        console.error("Invalid or missing onboarding_step:", step, "for business:", businessData.id)
        setError("Onboarding state is invalid. Please contact support.")
        setLoading(false)
        return
      }
      // Service: map legacy steps into new flow so existing users land on a valid step
      let stepToSet = step
      if (businessData.industry === "service" && (step === "add_customer" || step === "add_product")) {
        stepToSet = "create_invoice"
      }
      setCurrentStep(stepToSet as OnboardingStep)

      setLoading(false)
    } catch (err) {
      console.error("Error loading business:", err)
      setLoading(false)
    }
  }

  const updateOnboardingStep = async (step: OnboardingStep) => {
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

  const handleStepComplete = async (nextStep: OnboardingStep) => {
    await updateOnboardingStep(nextStep)
    
    if (nextStep === "complete") {
      // Redirect to correct dashboard based on industry
      if (business?.industry === "retail") {
        router.push("/pos")
      } else if (business?.industry === "service") {
        router.push("/dashboard")
      } else if (business?.industry === "logistics") {
        router.push("/rider/dashboard")
      } else {
        router.push("/dashboard")
      }
    }
  }

  const skipOnboarding = async () => {
    // VALIDATION: business.name must exist before onboarding can be skipped/completed
    if (!business?.name || business.name.trim() === "") {
      console.error("Cannot skip onboarding: business.name is missing or empty")
      toast.showToast("Cannot complete onboarding: Business name is required. Please complete your business profile first.", "warning")
      return
    }
    
    await updateOnboardingStep("complete")
    
    if (business?.industry === "retail") {
      router.push("/pos")
    } else if (business?.industry === "service") {
      router.push("/dashboard")
    } else if (business?.industry === "logistics") {
      router.push("/rider/dashboard")
    } else {
      router.push("/dashboard")
    }
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

  // Different onboarding steps based on industry
  const getSteps = () => {
    const industry = business?.industry
    
    // Retail onboarding steps
    if (industry === "retail") {
      return [
        { id: "business_profile", label: "Business Profile", route: "/settings/business-profile" },
        { id: "add_product", label: "Add Products", route: "/products" },
        { id: "open_register", label: "Open Register Session", route: "/sales/open-session" },
        { id: "start_pos", label: "Start POS", route: "/pos" },
      ]
    }
    
    // Service onboarding steps (reordered: profile → industry → tax → payments → communication → accounting info → first invoice)
    if (industry === "service") {
      return [
        { id: "business_profile", label: "Business Profile", route: "/settings/business-profile" },
        { id: "industry_confirmation", label: "Industry", route: "" },
        { id: "tax_awareness", label: "Tax", route: "" },
        { id: "payment_channels", label: "Payment Channels", route: "/settings/payments" },
        { id: "communication_channels", label: "Communication", route: "" },
        { id: "accounting_readiness", label: "Accounting", route: "" },
        { id: "create_invoice", label: "First Invoice", route: "/invoices/new" },
      ]
    }
    
    // Logistics onboarding steps
    if (industry === "logistics") {
      return [
        { id: "business_profile", label: "Business Profile", route: "/settings/business-profile" },
        { id: "add_rider", label: "Add Rider", route: "/rider/riders" },
        { id: "setup_pricing", label: "Setup Pricing", route: "/rider/settings" },
        { id: "start_deliveries", label: "Start Deliveries", route: "/rider/dashboard" },
      ]
    }
    
    // Default steps (fallback)
    return [
      { id: "business_profile", label: "Business Profile", route: "/settings/business-profile" },
      { id: "add_customer", label: "Add Customer", route: "/customers/new" },
      { id: "add_product", label: "Add Product/Service", route: "/products" },
      { id: "create_invoice", label: "Create First Invoice", route: "/invoices/new" },
    ]
  }
  
  const steps = getSteps()

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep)

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              Welcome to Finza!
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Let's get your business set up in just a few steps
            </p>
          </div>

          {/* Progress Steps */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              {steps.map((step, index) => {
                const isActive = step.id === currentStep
                const isCompleted = index < currentStepIndex
                return (
                  <div key={step.id} className="flex items-center flex-1">
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
                        {step.label}
                      </p>
                    </div>
                    {index < steps.length - 1 && (
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
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  Step 1: Complete Your Business Profile
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  Add your business logo, contact information, and basic details. This information will appear on all your invoices and documents.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => router.push(`/settings/business-profile?onboarding=${business?.industry || "service"}&return=/onboarding`)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
                  >
                    Go to Business Profile
                  </button>
                  <button
                    onClick={() => {
                      const nextStep = business?.industry === "retail" ? "add_product"
                        : business?.industry === "logistics" ? "add_rider"
                        : business?.industry === "service" ? "industry_confirmation"
                        : "add_customer"
                      handleStepComplete(nextStep as OnboardingStep)
                    }}
                    className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium"
                  >
                    Skip for Now
                  </button>
                </div>
              </div>
            )}

            {currentStep === "industry_confirmation" && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  Step 2: Confirm Your Industry
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  You're set up as a <strong>{business?.industry === "service" ? "Service" : business?.industry || "Service"}</strong> business. This determines which features and reports are available. You can't change this later.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => handleStepComplete("tax_awareness")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {currentStep === "tax_awareness" && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  Step 3: Tax Awareness
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  FINZA uses your business country and tax settings to calculate VAT and other taxes on invoices. You can review and update tax-related settings in Business Profile and when creating invoices.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => handleStepComplete("payment_channels")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {currentStep === "payment_channels" && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  Step 4: Payment Channels
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  Set up how you get paid: Mobile Money, bank transfer, or cash. You can enable or change these anytime in Settings.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => router.push("/settings/payments")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
                  >
                    Go to Payment Settings
                  </button>
                  <button
                    onClick={() => handleStepComplete("communication_channels")}
                    className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium"
                  >
                    Skip for Now
                  </button>
                </div>
              </div>
            )}

            {currentStep === "communication_channels" && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  Step 5: Communication
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  You can send invoices and documents by <strong>email</strong> or open a prefilled{" "}
                  <strong>WhatsApp</strong> chat (<code className="text-sm bg-gray-100 dark:bg-gray-700 px-1 rounded">wa.me</code>
                  ) in your browser—no separate integration required. Add customer email and phone numbers so both options work.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => handleStepComplete("accounting_readiness")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {currentStep === "accounting_readiness" && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  Step 6: Accounting Readiness
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  FINZA prepares your accounting automatically when you send your first invoice. You don't need to do anything now—your ledger and reports will be ready when you need them.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => handleStepComplete("create_invoice")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {currentStep === "add_customer" && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  Step 2: Add Your First Customer
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  Create a customer record so you can start sending invoices. You can add more customers later.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => router.push("/customers/new")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
                  >
                    Add Customer
                  </button>
                  <button
                    onClick={() => handleStepComplete("add_product")}
                    className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium"
                  >
                    Skip for Now
                  </button>
                </div>
              </div>
            )}

            {currentStep === "add_product" && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  {business?.industry === "retail" 
                    ? "Step 2: Add Products to Your Inventory" 
                    : "Step 3: Add a Product or Service"
                  }
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  {business?.industry === "retail"
                    ? "Add products to your inventory so you can start selling them at the POS terminal."
                    : "Create your first product or service that you'll sell to customers. This makes creating invoices faster."
                  }
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => router.push("/products")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
                  >
                    {business?.industry === "retail" ? "Add Products" : "Add Product/Service"}
                  </button>
                  <button
                    onClick={() => {
                      const nextStep = business?.industry === "retail" ? "open_register" : "create_invoice"
                      handleStepComplete(nextStep as OnboardingStep)
                    }}
                    className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium"
                  >
                    Skip for Now
                  </button>
                </div>
              </div>
            )}

            {currentStep === "open_register" && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  Step 3: Open Register Session
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  Open a register session to start processing sales at your POS terminal.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => router.push("/sales/open-session")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
                  >
                    Open Register
                  </button>
                  <button
                    onClick={() => handleStepComplete("start_pos")}
                    className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium"
                  >
                    Skip for Now
                  </button>
                </div>
              </div>
            )}

            {currentStep === "start_pos" && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  Step 4: Start Using POS
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  You're ready to start selling! Go to the POS terminal to begin processing transactions.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => router.push("/pos")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
                  >
                    Go to POS
                  </button>
                  <button
                    onClick={() => handleStepComplete("complete")}
                    className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium"
                  >
                    Skip for Now
                  </button>
                </div>
              </div>
            )}

            {currentStep === "add_rider" && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  Step 2: Add Your First Rider
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  Add a rider to your delivery team so you can start managing deliveries.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => router.push("/rider/riders")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
                  >
                    Add Rider
                  </button>
                  <button
                    onClick={() => handleStepComplete("setup_pricing")}
                    className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium"
                  >
                    Skip for Now
                  </button>
                </div>
              </div>
            )}

            {currentStep === "setup_pricing" && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  Step 3: Setup Delivery Pricing
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  Configure your delivery pricing structure and distance tiers.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => router.push("/rider/settings")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
                  >
                    Setup Pricing
                  </button>
                  <button
                    onClick={() => handleStepComplete("start_deliveries")}
                    className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium"
                  >
                    Skip for Now
                  </button>
                </div>
              </div>
            )}

            {currentStep === "start_deliveries" && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  Step 4: Start Managing Deliveries
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  You're ready to start managing deliveries! Go to the rider dashboard to begin.
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => router.push("/rider/dashboard")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
                  >
                    Go to Dashboard
                  </button>
                  <button
                    onClick={() => handleStepComplete("complete")}
                    className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium"
                  >
                    Skip for Now
                  </button>
                </div>
              </div>
            )}

            {currentStep === "create_invoice" && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  {business?.industry === "service" ? "Step 7: Create Your First Invoice" : "Step 4: Create Your First Invoice"}
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  Create your first invoice to get started. You can send it by email or open WhatsApp with a prefilled message (wa.me).
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => router.push("/invoices/new")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium"
                  >
                    Create Invoice
                  </button>
                  <button
                    onClick={() => handleStepComplete("complete")}
                    className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium"
                  >
                    Skip for Now
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mb-6">
            <OnboardingAIAssistant step={currentStep} />
          </div>

          {/* Skip All Button */}
          <div className="text-center">
            <button
              onClick={skipOnboarding}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm underline"
            >
              Skip onboarding and go to dashboard
            </button>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}

