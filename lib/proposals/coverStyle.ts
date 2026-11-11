import { getProposalTheme, type ProposalTheme } from "./design"
import { normalizeTemplateId, type ProposalTemplateId } from "./templates"

export const COVER_IMAGE_POSITIONS = ["center", "top", "bottom", "left", "right"] as const
export type CoverImagePosition = (typeof COVER_IMAGE_POSITIONS)[number]

/** Strict 6-digit HEX only. No rgb(), named colours, alpha or CSS expressions. */
export function normalizeCoverColor(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : ""
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : null
}

export function normalizeCoverImagePosition(value: unknown): CoverImagePosition | null {
  return (COVER_IMAGE_POSITIONS as readonly string[]).includes(String(value ?? ""))
    ? (value as CoverImagePosition)
    : null
}

function channelToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const normalized = normalizeCoverColor(hex)
  if (!normalized) return 0
  const value = normalized.slice(1)
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b)
}

export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  const light = Math.max(l1, l2)
  const dark = Math.min(l1, l2)
  return (light + 0.05) / (dark + 0.05)
}

export type CoverReadableInk = {
  ink: string
  ratio: number
  needsScrim: boolean
}

/** Choose the better of near-black/near-white, using WCAG 4.5:1 for body text. */
export function readableCoverInk(background: string): CoverReadableInk {
  const dark = "#111827"
  const light = "#ffffff"
  const darkRatio = contrastRatio(background, dark)
  const lightRatio = contrastRatio(background, light)
  const ink = lightRatio >= darkRatio ? light : dark
  const ratio = Math.max(darkRatio, lightRatio)
  return { ink, ratio, needsScrim: ratio < 4.5 }
}

export type ProposalCoverStyle = {
  isCustom: boolean
  backgroundColor: string
  ink: string
  muted: string
  rule: string
  accent: string
  accentContrast: string
  coverPattern: ProposalTheme["coverPattern"]
  coverStyle: ProposalTheme["coverStyle"]
  imagePosition: CoverImagePosition
  /** CSS background layer for the reader shade / PDF art. Empty means keep template CSS. */
  overlay: string
  /** Optional readability panel behind cover text for low-contrast custom colours. */
  scrim: string | null
  isLightBackground: boolean
}

function isLightColor(hex: string): boolean {
  return relativeLuminance(hex) > 0.46
}

function colorOverlay(templateId: ProposalTemplateId, accent: string): string {
  switch (normalizeTemplateId(templateId)) {
    case "modern_v1":
      return `radial-gradient(circle at 82% 18%, ${accent}66 0, transparent 38%), linear-gradient(135deg, rgba(255,255,255,0.08), rgba(0,0,0,0.18))`
    case "premium_v1":
      return `radial-gradient(circle at 84% 18%, ${accent}66 0, transparent 34%), linear-gradient(160deg, rgba(255,255,255,0.05), rgba(0,0,0,0.28))`
    case "minimal_v1":
      return `linear-gradient(155deg, rgba(255,255,255,0.10), rgba(0,0,0,0.05))`
    default:
      return ""
  }
}

const IMAGE_OVERLAY =
  "linear-gradient(90deg, rgba(0,0,0,0.68) 0%, rgba(0,0,0,0.56) 58%, rgba(0,0,0,0.42) 100%), linear-gradient(180deg, rgba(0,0,0,0.28), rgba(0,0,0,0.62))"

export function resolveProposalCoverStyle(input: {
  templateId: string | null | undefined
  accentColor?: string | null
  typography?: string | null
  backgroundColor?: string | null
  imagePosition?: string | null
  hasImage?: boolean
}): ProposalCoverStyle {
  const theme = getProposalTheme(input.templateId, {
    accentColor: input.accentColor,
    typography: input.typography,
  })
  const templateId = normalizeTemplateId(input.templateId)
  const color = normalizeCoverColor(input.backgroundColor)
  const position = normalizeCoverImagePosition(input.imagePosition) ?? "center"
  const hasImage = Boolean(input.hasImage)
  const isCustom = Boolean(color) || (hasImage && Boolean(normalizeCoverImagePosition(input.imagePosition)))

  if (!isCustom) {
    return {
      isCustom: false,
      backgroundColor: theme.coverBg,
      ink: theme.coverInk,
      muted: theme.coverMuted,
      rule: templateId === "minimal_v1" ? theme.rule : "rgba(255,255,255,0.20)",
      accent: theme.accent,
      accentContrast: theme.accentContrast,
      coverPattern: theme.coverPattern,
      coverStyle: theme.coverStyle,
      imagePosition: "center",
      overlay: "",
      scrim: null,
      isLightBackground: isLightColor(theme.coverBg),
    }
  }

  if (hasImage) {
    return {
      isCustom: true,
      backgroundColor: color ?? theme.coverBg,
      ink: "#ffffff",
      muted: "rgba(255,255,255,0.80)",
      rule: "rgba(255,255,255,0.32)",
      accent: theme.accent,
      accentContrast: theme.accentContrast,
      coverPattern: theme.coverPattern,
      coverStyle: theme.coverStyle,
      imagePosition: position,
      overlay: IMAGE_OVERLAY,
      scrim: null,
      isLightBackground: false,
    }
  }

  const background = color ?? theme.coverBg
  const readable = readableCoverInk(background)
  const isLight = isLightColor(background)
  return {
    isCustom: true,
    backgroundColor: background,
    ink: readable.ink,
    muted: readable.ink === "#ffffff" ? "rgba(255,255,255,0.80)" : "rgba(17,24,39,0.74)",
    rule: readable.ink === "#ffffff" ? "rgba(255,255,255,0.28)" : "rgba(17,24,39,0.22)",
    accent: theme.accent,
    accentContrast: readable.ink === "#ffffff" ? "#ffffff" : "#111827",
    coverPattern: theme.coverPattern,
    coverStyle: theme.coverStyle,
    imagePosition: "center",
    overlay: colorOverlay(templateId, theme.accent),
    scrim: readable.needsScrim ? (isLight ? "rgba(255,255,255,0.72)" : "rgba(0,0,0,0.42)") : null,
    isLightBackground: isLight,
  }
}

export function proposalCoverCssVariables(style: ProposalCoverStyle): Record<string, string> {
  return {
    "--pp-cover-bg": style.backgroundColor,
    "--pp-cover-ink": style.ink,
    "--pp-cover-muted": style.muted,
    "--pp-cover-rule": style.rule,
    "--pp-cover-overlay": style.overlay,
    ...(style.scrim ? { "--pp-cover-scrim": style.scrim } : {}),
  }
}

export const PROPOSAL_COVER_COLOR_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Navy", value: "#0b1f3a" },
  { label: "Royal blue", value: "#1d4ed8" },
  { label: "Teal", value: "#0f766e" },
  { label: "Forest", value: "#14532d" },
  { label: "Burgundy", value: "#6b1f2a" },
  { label: "Warm brown", value: "#5c3b24" },
  { label: "Charcoal", value: "#1c1917" },
  { label: "Cream", value: "#fbf8f2" },
  { label: "Light grey", value: "#eef2f7" },
]
