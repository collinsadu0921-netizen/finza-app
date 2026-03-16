/**
 * WhatsApp template renderer.
 * Replaces {{token}} placeholders with variables. No eval or dynamic execution.
 * Missing variables → empty string. Line breaks preserved.
 */
export function renderWhatsAppTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return variables[key] ?? ""
  })
}
