import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  type BusinessActivationEventName,
  isBusinessActivationEventName,
} from "@/lib/growth/activationEvents"

export type RecordBusinessActivationEventInput = {
  businessId: string
  eventName: BusinessActivationEventName
  metadata?: Record<string, unknown>
  eventAt?: Date
}

export type RecordBusinessActivationEventResult =
  | { ok: true; recorded: true }
  | { ok: true; recorded: false; reason: "duplicate" | "invalid_event" }
  | { ok: false; error: string }

/**
 * Inserts a milestone once per (business_id, event_name). Safe to call from hot paths.
 */
export async function recordBusinessActivationEvent(
  supabase: SupabaseClient,
  input: RecordBusinessActivationEventInput
): Promise<RecordBusinessActivationEventResult> {
  if (!isBusinessActivationEventName(input.eventName)) {
    return { ok: true, recorded: false, reason: "invalid_event" }
  }

  const row = {
    business_id: input.businessId,
    event_name: input.eventName,
    event_at: (input.eventAt ?? new Date()).toISOString(),
    metadata: input.metadata ?? {},
  }

  const { error } = await supabase.from("business_activation_events").insert(row)

  if (error?.code === "23505") {
    return { ok: true, recorded: false, reason: "duplicate" }
  }
  if (error) {
    return { ok: false, error: error.message }
  }
  return { ok: true, recorded: true }
}

/** Fire-and-forget wrapper for API routes. */
export function voidRecordBusinessActivationEvent(
  supabase: SupabaseClient,
  input: RecordBusinessActivationEventInput
): void {
  void recordBusinessActivationEvent(supabase, input).catch((err) => {
    console.error("[activationEvent]", input.eventName, input.businessId, err)
  })
}
