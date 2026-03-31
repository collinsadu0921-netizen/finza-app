/**
 * Official Finza brand lockup: raster from /public/brand (approved export; do not redraw).
 * variant="white" requires /public/brand/finza-logo-white.png from design (not approximated).
 */

type FinzaLogoProps = {
  /** default: full color logo; white: for dark backgrounds */
  variant?: "default" | "white"
  /** Rendered height in CSS pixels; width follows aspect ratio */
  height?: number
  className?: string
}

export function FinzaLogo({ variant = "default", height = 26, className = "" }: FinzaLogoProps) {
  const src =
    variant === "white" ? "/brand/finza-logo-white.png" : "/brand/finza-logo.png"
  return (
    <img
      src={src}
      alt="Finza"
      className={`w-auto max-w-full ${className}`.trim()}
      style={{ height, width: "auto" }}
      decoding="async"
    />
  )
}
