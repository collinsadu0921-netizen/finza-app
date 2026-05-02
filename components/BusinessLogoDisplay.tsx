"use client"

import { useEffect, useState } from "react"

export type BusinessLogoVariant =
  | "sidebar"
  | "document"
  | "compact"
  | "toolbar"
  | "hero"
  | "workspace"

export type BusinessLogoDisplayProps = {
  /** Public URL from `businesses.logo_url` (or store logo where applicable). */
  logoUrl?: string | null
  /** Used for initials fallback and accessible alt text. */
  businessName?: string | null
  /** Scales initials / skeleton and bumps document image bounds when `xl`. */
  size?: "sm" | "md" | "lg" | "xl"
  className?: string
  /** Corner style for initials + skeleton only (logo image uses subtle rounding). */
  rounded?: "full" | "lg" | "none"
  /** Layout preset: image uses max-width/height + object-contain, no square crop. */
  variant?: BusinessLogoVariant
  /**
   * When `false` and there is no `logoUrl`, show a neutral skeleton.
   * When a `logoUrl` exists, the image is shown regardless (avoids blocking on slow metadata).
   * @default true
   */
  brandingResolved?: boolean
  /**
   * @deprecated No longer hides the image; logo renders immediately when `logoUrl` is set.
   */
  deferLogoImageReveal?: boolean
  /**
   * @deprecated Use `variant="document"` instead. If `variant` is omitted, maps to variant.
   */
  surface?: "app" | "document"
}

function resolveVariant(
  variant: BusinessLogoDisplayProps["variant"],
  surface: BusinessLogoDisplayProps["surface"]
): BusinessLogoVariant {
  if (variant) return variant
  if (surface === "document") return "document"
  return "sidebar"
}

function initialsRoundedClass(rounded: BusinessLogoDisplayProps["rounded"]) {
  if (rounded === "none") return "rounded-none"
  if (rounded === "lg") return "rounded-lg"
  return "rounded-full"
}

/** Max bounds for real logos — transparent background, no crop. */
function imageShell(variant: BusinessLogoVariant, size: BusinessLogoDisplayProps["size"]) {
  if (variant === "document" && size === "xl") {
    return "max-h-24 max-w-[10rem] sm:max-h-28 sm:max-w-[11rem]"
  }
  if (variant === "document" && size === "lg") {
    return "max-h-[4.5rem] max-w-[13rem] sm:max-h-20 sm:max-w-[15rem]"
  }
  switch (variant) {
    case "sidebar":
      return "max-h-8 max-w-24"
    case "document":
      return "max-h-16 max-w-[12rem] sm:max-h-[4.5rem] sm:max-w-[13rem]"
    case "compact":
      return "max-h-8 max-w-[6.5rem]"
    case "toolbar":
      return "max-h-8 max-w-[7.5rem]"
    case "hero":
      return "max-h-[6.5rem] w-auto max-w-[min(320px,100%)] sm:max-h-[7.5rem]"
    case "workspace":
      return "max-h-10 max-w-10"
    default:
      return "max-h-10 max-w-[9rem]"
  }
}

function initialsShell(variant: BusinessLogoVariant, size: BusinessLogoDisplayProps["size"]) {
  if (variant === "document" && size === "xl") {
    return "h-24 w-24 sm:h-28 sm:w-28 max-h-28 max-w-28"
  }
  switch (variant) {
    case "sidebar":
      return "h-9 w-9 max-h-9 max-w-9"
    case "document":
      if (size === "sm") {
        /* Same footprint as service dashboard slot (96×48) */
        return "flex h-12 w-24 max-h-[48px] max-w-[96px] flex-shrink-0 items-center justify-center"
      }
      return size === "lg"
        ? "h-14 w-14 sm:h-16 sm:w-16"
        : "h-12 w-12 sm:h-14 sm:w-14"
    case "compact":
    case "toolbar":
      return "h-8 w-8"
    case "hero":
      return "h-[4.25rem] w-[4.25rem] sm:h-[4.5rem] sm:w-[4.5rem]"
    case "workspace":
      return "h-10 w-10"
    default:
      return "h-10 w-10"
  }
}

function skeletonShell(variant: BusinessLogoVariant, size: BusinessLogoDisplayProps["size"]) {
  if (variant === "document" && size === "xl") {
    return "h-24 w-28 sm:h-28 sm:w-32 rounded-lg"
  }
  switch (variant) {
    case "sidebar":
      return "h-8 w-20 max-w-24 rounded-lg"
    case "document":
      if (size === "sm") return "h-12 w-24 max-h-[48px] max-w-[96px] rounded-lg"
      return size === "lg" ? "h-14 w-28 sm:h-16 sm:w-32 rounded-lg" : "h-12 w-24 sm:h-14 sm:w-28 rounded-lg"
    case "compact":
    case "toolbar":
      return "h-8 w-20 rounded-md"
    case "hero":
      return "h-16 w-40 sm:h-[7rem] sm:w-44 rounded-lg"
    case "workspace":
      return "h-10 w-10 rounded-lg"
    default:
      return "h-10 w-24 rounded-lg"
  }
}

function initialsTextClass(size: BusinessLogoDisplayProps["size"], variant: BusinessLogoVariant) {
  if (variant === "document" && size === "xl") return "text-2xl sm:text-3xl"
  if (variant === "document" && size === "sm") return "text-base font-semibold"
  if (variant === "sidebar") return "text-sm"
  if (size === "sm" || variant === "compact" || variant === "toolbar") return "text-sm"
  if (size === "lg" || size === "xl") return "text-xl"
  return "text-base sm:text-lg"
}

/** Service dashboard: fixed 96×48 slot; image max 96×40 per product spec */
function ServiceDashboardLogoSlot({
  logoUrl,
  businessName,
  onImgError,
  className,
}: {
  logoUrl: string
  businessName?: string | null
  onImgError: () => void
  className?: string
}) {
  return (
    <div
      className={`box-border flex h-12 w-24 max-h-[48px] max-w-[96px] flex-shrink-0 items-center justify-center overflow-hidden ${className ?? ""}`.trim()}
    >
      <img
        src={logoUrl.trim()}
        alt={businessName?.trim() ? `${businessName.trim()} logo` : "Business logo"}
        className="block h-auto w-auto max-h-[40px] max-w-[96px] object-contain"
        loading="eager"
        decoding="async"
        onError={onImgError}
      />
    </div>
  )
}

export default function BusinessLogoDisplay({
  logoUrl,
  businessName,
  size = "md",
  className = "",
  rounded = "lg",
  variant: variantProp,
  brandingResolved = true,
  deferLogoImageReveal: _deferLogoImageReveal,
  surface,
}: BusinessLogoDisplayProps) {
  const variant = resolveVariant(variantProp, surface)
  const [imgFailed, setImgFailed] = useState(false)

  useEffect(() => {
    setImgFailed(false)
  }, [logoUrl])

  const initial = businessName?.trim()
    ? businessName.trim().charAt(0).toUpperCase()
    : "B"

  const hasUrl = Boolean(logoUrl?.trim())
  /** Show image whenever we have a URL and decode hasn't permanently failed */
  const showImage = hasUrl && !imgFailed

  const imgRounded = "rounded-md"
  const ir = initialsRoundedClass(rounded)

  /* Skeleton only when branding is unresolved AND we have nothing to show yet */
  if (!brandingResolved && !hasUrl) {
    return (
      <div
        className={`flex-shrink-0 animate-pulse bg-slate-200/90 dark:bg-slate-600/50 ${skeletonShell(variant, size)} ${className}`}
        aria-hidden
      />
    )
  }

  if (showImage && variant === "document" && size === "sm") {
    return (
      <ServiceDashboardLogoSlot
        logoUrl={logoUrl!.trim()}
        businessName={businessName}
        onImgError={() => setImgFailed(true)}
        className={className}
      />
    )
  }

  if (showImage) {
    const shell = `relative flex flex-shrink-0 items-center justify-start ${imageShell(variant, size)} ${className}`
    return (
      <div className={shell}>
        <img
          src={logoUrl!.trim()}
          alt={businessName?.trim() ? `${businessName.trim()} logo` : "Business logo"}
          className={`max-h-full max-w-full object-contain ${imgRounded}`}
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
        />
      </div>
    )
  }

  /* Initials: document/sm uses same slot dimensions as logo */
  if (variant === "document" && size === "sm") {
    return (
      <div
        className={`flex h-12 w-24 max-h-[48px] max-w-[96px] flex-shrink-0 items-center justify-center bg-gradient-to-br from-blue-600 to-blue-700 text-white dark:from-blue-500 dark:to-blue-600 ${initialsTextClass(size, variant)} ${ir} ${className}`}
        aria-hidden
      >
        {initial}
      </div>
    )
  }

  return (
    <div
      className={`flex-shrink-0 flex items-center justify-center text-white font-semibold bg-gradient-to-br from-blue-600 to-blue-700 dark:from-blue-500 dark:to-blue-600 ${initialsTextClass(size, variant)} ${initialsShell(variant, size)} ${ir} ${className}`}
      aria-hidden
    >
      {initial}
    </div>
  )
}
