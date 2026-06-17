export const SIGNUP_GOALS = [
  "send_invoices",
  "track_payments",
  "manage_expenses",
  "quotes_and_proposals",
  "other",
] as const

export type SignupGoal = (typeof SIGNUP_GOALS)[number]

export const SIGNUP_GOAL_LABELS: Record<SignupGoal, string> = {
  send_invoices: "Send invoices & get paid",
  track_payments: "Track payments & collections",
  manage_expenses: "Manage expenses & records",
  quotes_and_proposals: "Send quotes & proposals",
  other: "Something else",
}

export function isSignupGoal(value: unknown): value is SignupGoal {
  return typeof value === "string" && (SIGNUP_GOALS as readonly string[]).includes(value)
}

export function signupGoalLabel(goal: string | null | undefined): string {
  if (goal && isSignupGoal(goal)) return SIGNUP_GOAL_LABELS[goal]
  return goal?.trim() || "Not specified"
}
