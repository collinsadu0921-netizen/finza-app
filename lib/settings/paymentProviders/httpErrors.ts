export function statusForSettingsError(message: string): number {
  if (message === "Forbidden" || message.includes("Forbidden")) return 403
  if (message.includes("not found") || message.includes("Not found")) return 404
  if (message.includes("environment mismatch")) return 400
  if (message.includes("duplicate") || message.includes("unique")) return 409
  return 400
}
