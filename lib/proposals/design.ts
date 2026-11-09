import {
  DEFAULT_PROPOSAL_TEMPLATE_ID,
  LEGACY_PROPOSAL_TEMPLATE_ID,
  getProposalTemplateMeta,
  normalizeTemplateId,
  type ProposalTemplateId,
} from "./templates"

export const PROPOSAL_TYPOGRAPHY_OPTIONS = ["sans", "serif", "editorial"] as const
export type ProposalTypography = (typeof PROPOSAL_TYPOGRAPHY_OPTIONS)[number]

export type ProposalTheme = {
  id: ProposalTemplateId
  label: string
  accent: string
  accentSoft: string
  accentContrast: string
  paper: string
  paperAlt: string
  ink: string
  muted: string
  rule: string
  card: string
  coverBg: string
  coverInk: string
  coverMuted: string
  coverPattern: "none" | "grid" | "orbs" | "rules"
  headingFont: string
  bodyFont: string
  eyebrowFont: string
  radius: string
  coverStyle: "minimal" | "modern" | "premium" | "classic"
}

const FONT_STACKS: Record<ProposalTypography, { heading: string; body: string; eyebrow: string }> = {
  sans: {
    heading: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    body: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    eyebrow: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  serif: {
    heading: 'Georgia, Cambria, "Times New Roman", ui-serif, serif',
    body: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    eyebrow: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  editorial: {
    heading: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", ui-serif, serif',
    body: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", ui-serif, serif',
    eyebrow: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
}

const TEMPLATE_DEFAULTS: Record<
  ProposalTemplateId,
  Pick<
    ProposalTheme,
    | "accent"
    | "paper"
    | "paperAlt"
    | "ink"
    | "muted"
    | "rule"
    | "card"
    | "coverBg"
    | "coverInk"
    | "coverMuted"
    | "coverPattern"
    | "coverStyle"
    | "radius"
  >
> = {
  minimal_v1: {
    accent: "#1f2937",
    paper: "#ffffff",
    paperAlt: "#f8f7f4",
    ink: "#111827",
    muted: "#6b7280",
    rule: "#e5e7eb",
    card: "#fbfaf7",
    coverBg: "#ffffff",
    coverInk: "#111827",
    coverMuted: "#6b7280",
    coverPattern: "rules",
    coverStyle: "minimal",
    radius: "2px",
  },
  modern_v1: {
    accent: "#0f766e",
    paper: "#ffffff",
    paperAlt: "#f1f5f9",
    ink: "#0f172a",
    muted: "#64748b",
    rule: "#e2e8f0",
    card: "#f8fafc",
    coverBg: "#0b1220",
    coverInk: "#f8fafc",
    coverMuted: "#94a3b8",
    coverPattern: "grid",
    coverStyle: "modern",
    radius: "10px",
  },
  premium_v1: {
    accent: "#a6773f",
    paper: "#fbf8f2",
    paperAlt: "#f3ede2",
    ink: "#292524",
    muted: "#78716c",
    rule: "#e7ddcc",
    card: "#fffdf8",
    coverBg: "#1c1917",
    coverInk: "#faf7f2",
    coverMuted: "#c9bda9",
    coverPattern: "orbs",
    coverStyle: "premium",
    radius: "2px",
  },
  standard_v1: {
    accent: "#0f172a",
    paper: "#ffffff",
    paperAlt: "#f8fafc",
    ink: "#0f172a",
    muted: "#64748b",
    rule: "#e2e8f0",
    card: "#f8fafc",
    coverBg: "#f8fafc",
    coverInk: "#0f172a",
    coverMuted: "#64748b",
    coverPattern: "none",
    coverStyle: "classic",
    radius: "12px",
  },
}

export function normalizeTypography(value: unknown): ProposalTypography {
  return (PROPOSAL_TYPOGRAPHY_OPTIONS as readonly string[]).includes(String(value ?? ""))
    ? (value as ProposalTypography)
    : "sans"
}

export function defaultTypographyForTemplate(templateId: string | null | undefined): ProposalTypography {
  switch (normalizeTemplateId(templateId)) {
    case "minimal_v1":
      return "serif"
    case "premium_v1":
      return "editorial"
    default:
      return "sans"
  }
}

export function normalizeAccentColor(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : ""
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : fallback
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "")
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function readableContrast(hex: string): string {
  const normalized = hex.replace("#", "")
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.62 ? "#111827" : "#ffffff"
}

export function getProposalTheme(
  templateId: string | null | undefined,
  options?: { accentColor?: string | null; typography?: string | null }
): ProposalTheme {
  const id = normalizeTemplateId(templateId)
  const meta = getProposalTemplateMeta(id)
  const defaults = TEMPLATE_DEFAULTS[id] ?? TEMPLATE_DEFAULTS[DEFAULT_PROPOSAL_TEMPLATE_ID]
  const accent = normalizeAccentColor(options?.accentColor, defaults.accent)
  const type = options?.typography
    ? normalizeTypography(options.typography)
    : defaultTypographyForTemplate(id)
  const fonts = FONT_STACKS[type]

  return {
    id,
    label: meta.label,
    ...defaults,
    accent,
    accentSoft: hexToRgba(accent, 0.1),
    accentContrast: readableContrast(accent),
    headingFont: fonts.heading,
    bodyFont: fonts.body,
    eyebrowFont: fonts.eyebrow,
  }
}

export function proposalThemeCssVariables(theme: ProposalTheme): Record<string, string> {
  return {
    "--pp-accent": theme.accent,
    "--pp-accent-soft": theme.accentSoft,
    "--pp-accent-contrast": theme.accentContrast,
    "--pp-paper": theme.paper,
    "--pp-paper-alt": theme.paperAlt,
    "--pp-ink": theme.ink,
    "--pp-muted": theme.muted,
    "--pp-rule": theme.rule,
    "--pp-card": theme.card,
    "--pp-cover-bg": theme.coverBg,
    "--pp-cover-ink": theme.coverInk,
    "--pp-cover-muted": theme.coverMuted,
    "--pp-heading-font": theme.headingFont,
    "--pp-body-font": theme.bodyFont,
    "--pp-eyebrow-font": theme.eyebrowFont,
    "--pp-radius": theme.radius,
  }
}

export function isLegacyTemplate(templateId: string | null | undefined): boolean {
  return normalizeTemplateId(templateId) === LEGACY_PROPOSAL_TEMPLATE_ID
}
