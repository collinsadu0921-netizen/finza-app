import "server-only"

export function isMockSubscriptionFlowEnabled(): boolean {
  const defaultProvider = (process.env.DEFAULT_SUBSCRIPTION_PROVIDER ?? "").trim().toLowerCase()
  const hubtelMode = (process.env.HUBTEL_MODE ?? "").trim().toLowerCase()
  const hubtelEnabled = (process.env.HUBTEL_ENABLED ?? "false").trim().toLowerCase() === "true"
  return defaultProvider === "mock" && hubtelMode === "mock" && !hubtelEnabled
}

export function safeHubtelMode(): "disabled" | "mock" | "test" | "live" {
  const mode = (process.env.HUBTEL_MODE ?? "").trim().toLowerCase()
  if (mode === "mock" || mode === "test" || mode === "live" || mode === "disabled") return mode
  return "disabled"
}

