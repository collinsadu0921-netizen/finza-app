/**
 * Official Finza wordmark from /public/brand/finza-logo.svg.
 * Transparent, tightly cropped. Do not redraw, recolour, or stretch.
 */

type FinzaLogoProps = {
  /** Rendered width in CSS pixels; height follows the SVG aspect ratio */
  width?: number
  className?: string
  onError?: () => void
}

export function FinzaLogo({ width = 148, className = "", onError }: FinzaLogoProps) {
  return (
    <img
      src="/brand/finza-logo.svg"
      alt="Finza"
      className={`h-auto max-w-full object-contain object-left ${className}`.trim()}
      style={{ width, height: "auto" }}
      decoding="async"
      onError={onError}
    />
  )
}
