import type { BusinessActivationEventName } from "@/lib/growth/activationEvents"

/** Fire-and-forget client activation tracking (deduped server-side). */
export function trackActivationEvent(
  eventName: BusinessActivationEventName,
  businessId?: string
): void {
  void fetch("/api/growth/activation-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_name: eventName,
      ...(businessId ? { business_id: businessId } : {}),
    }),
  }).catch(() => {})
}
