import { buildWhatsAppLink } from "@/lib/communication/whatsappLink"
import { signupGoalLabel } from "@/lib/growth/signupGoals"

export type TrialConversionActivationState =
  | "setup_only"
  | "onboarding_in_progress"
  | "onboarding_complete"
  | "has_customer"
  | "has_invoice"
  | "has_payment"
  | "has_expense"
  | "viewed_pricing"
  | "subscribed"

export type TrialFollowUpContext = {
  businessName: string
  signupGoal: string | null
  trialStatus: string | null
  trialExpired: boolean
  trialGraceActive: boolean
  isLocked: boolean
  activationState: TrialConversionActivationState
  events: Set<string>
}

export type WhatsAppFollowUpAction = {
  whatsapp_url: string | null
  suggested_message: string
  next_recommended_action: string
}

function firstNameFromBusiness(name: string): string {
  const part = name.trim().split(/\s+/)[0]
  return part || "there"
}

function goalNudge(goal: string | null): string {
  switch (goal) {
    case "send_invoices":
      return "create and send your first invoice"
    case "track_payments":
      return "record a payment against an invoice"
    case "manage_expenses":
      return "log your first business expense"
    case "quotes_and_proposals":
      return "send your first quote to a customer"
    default:
      return "complete your first key step in Finza"
  }
}

export function deriveActivationState(events: Set<string>): TrialConversionActivationState {
  if (events.has("subscription_started")) return "subscribed"
  if (events.has("payment_recorded")) return "has_payment"
  if (events.has("invoice_created")) return "has_invoice"
  if (events.has("customer_created")) return "has_customer"
  if (events.has("pricing_viewed")) return "viewed_pricing"
  if (events.has("onboarding_completed")) return "onboarding_complete"
  if (events.has("onboarding_started")) return "onboarding_in_progress"
  return "setup_only"
}

export function buildWhatsAppFollowUpAction(
  ctx: TrialFollowUpContext,
  phone: string | null | undefined
): WhatsAppFollowUpAction {
  const name = firstNameFromBusiness(ctx.businessName)
  const goalLine = signupGoalLabel(ctx.signupGoal)

  let suggested_message = ""
  let next_recommended_action = ""

  if (ctx.isLocked) {
    next_recommended_action = "Help subscribe after grace/lock"
    suggested_message = `Hi ${name}, this is Finza. Your Finza Service trial for ${ctx.businessName} has ended and workspace access is limited. I can help you choose a plan and get back to full access. Would a quick call or WhatsApp chat work for you?`
  } else if (ctx.trialGraceActive || ctx.trialExpired) {
    next_recommended_action = "Trial ended — conversion nudge"
    suggested_message = `Hi ${name}, your Finza Service trial for ${ctx.businessName} has ended. You mentioned you wanted to ${goalLine.toLowerCase()}. I can help you pick a plan and ${goalNudge(ctx.signupGoal)}. Reply here if you'd like help.`
  } else if (ctx.trialStatus === "trialing" && !ctx.events.has("invoice_created")) {
    next_recommended_action = "Nudge first invoice"
    suggested_message = `Hi ${name}, welcome to Finza Service for ${ctx.businessName}. You signed up to ${goalLine.toLowerCase()}. Need help to ${goalNudge(ctx.signupGoal)}? I'm happy to walk you through it on WhatsApp.`
  } else if (ctx.events.has("invoice_created") && !ctx.events.has("payment_recorded")) {
    next_recommended_action = "Nudge payment recording"
    suggested_message = `Hi ${name}, I see you've created an invoice on Finza for ${ctx.businessName}. Would you like help recording the payment or sending a payment reminder to your customer?`
  } else if (ctx.activationState === "setup_only" || ctx.activationState === "onboarding_in_progress") {
    next_recommended_action = "Complete onboarding"
    suggested_message = `Hi ${name}, welcome to Finza Service. I noticed ${ctx.businessName} is still getting set up. Can I help you finish onboarding and ${goalNudge(ctx.signupGoal)}?`
  } else {
    next_recommended_action = "Check in on trial progress"
    suggested_message = `Hi ${name}, checking in on your Finza Service trial for ${ctx.businessName}. How is ${goalLine.toLowerCase()} going so far? Reply if you'd like any help.`
  }

  if (!phone?.trim()) {
    return { whatsapp_url: null, suggested_message, next_recommended_action }
  }

  const link = buildWhatsAppLink(phone, suggested_message)
  return {
    whatsapp_url: link.ok ? link.whatsappUrl : null,
    suggested_message,
    next_recommended_action,
  }
}

export function activationStateFromEventNames(eventNames: string[]): TrialConversionActivationState {
  return deriveActivationState(new Set(eventNames))
}
