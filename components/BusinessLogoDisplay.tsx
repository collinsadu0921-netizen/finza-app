"use client"

import { useState } from "react"

export type BusinessLogoDisplayProps = {
  /** Public or signed logo URL. When missing or on load error, initials fallback is shown. */
  logoUrl?: string | null
  /** Business name used for initials fallback (e.g. first letter). */
  businessName?: string | null
  /** Visual size preset. Use "xl" for document headers (e.g. invoice/credit/receipt). */
  size?: "sm" | "md" | "lg" | "xl"
  /** Optional class for the wrapper. */
  className?: string
  /** Whether to use a rounded-full circle (default true for avatar-style). */
  rounded?: "full" | "lg" | "none"
  /**
   * `app` — sidebar / chrome (neutral gray tile; respects dark mode).
   * `document` — invoice, receipt, credit note sheets (white tile so transparent PNGs match the page).
   */
  surface?: "app" | "document"
}

const sizeMap = {
  sm: "h-8 w-8 max-h-8 max-w-8",
  md: "h-10 w-10 sm:h-12 sm:w-12 max-h-12 max-w-[3rem]",
  lg: "h-14 w-14 sm:h-16 sm:w-16 max-h-16 max-w-[4rem]",
  xl: "h-20 w-20 sm:h-24 sm:w-24 max-h-[120px] max-w-[120px]",
}

export default function BusinessLogoDisplay({
  logoUrl,
  businessName,
  size = "md",
  className = "",
  rounded = "full",
  surface = "app",
}: BusinessLogoDisplayProps) {
  const [imgFailed, setImgFailed] = useState(false)
  const showImage = Boolean(logoUrl && !imgFailed)
  const initial = businessName?.trim()
    ? businessName.trim().charAt(0).toUpperCase()
    : "B"

  const roundedClass =
    rounded === "full"
      ? "rounded-full"
      : rounded === "lg"
        ? "rounded-lg"
        : "rounded"

  const surfaceClass =
    surface === "document"
      ? "bg-white"
      : "bg-gray-100 dark:bg-gray-700"

  return (
    <div
      className={`flex-shrink-0 overflow-hidden ${surfaceClass} ${roundedClass} ${sizeMap[size]} ${className}`}
      style={{ aspectRatio: "1" }}
    >
      {showImage ? (
        <img
          src={logoUrl!}
          alt="Business logo"
          className="h-full w-full object-contain"
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div
          className={`h-full w-full flex items-center justify-center text-white font-semibold ${size === "sm" ? "text-sm" : size === "lg" || size === "xl" ? "text-xl" : "text-base sm:text-lg"} bg-gradient-to-br from-blue-600 to-blue-700 dark:from-blue-500 dark:to-blue-600 ${roundedClass}`}
          aria-hidden
        >
          {initial}
        </div>
      )}
    </div>
  )
}
