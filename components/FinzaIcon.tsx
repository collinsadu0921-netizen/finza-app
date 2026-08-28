/**
 * Official Finza symbol from /public/brand/finza-icon.svg.
 * Transparent square mark for compact navigation and icon slots.
 * Do not redraw, recolour, or stretch.
 */

type FinzaIconProps = {
  /** Square container size in CSS pixels */
  size?: number
  className?: string
  /** When true, hide from assistive technology (parent already names the control) */
  decorative?: boolean
  onError?: () => void
}

export function FinzaIcon({ size = 36, className = "", decorative = false, onError }: FinzaIconProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden={decorative || undefined}
    >
      <img
        src="/brand/finza-icon.svg"
        alt={decorative ? "" : "Finza"}
        className="h-full w-full object-contain"
        decoding="async"
        onError={onError}
      />
    </span>
  )
}
