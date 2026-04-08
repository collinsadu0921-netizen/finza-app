"use client"

import { resolveDemoVideoEmbedSrc } from "@/lib/demoVideo"
import { cn } from "@/lib/utils"

type FinzaDemoVideoEmbedProps = {
  className?: string
  title?: string
}

/**
 * Responsive 16:9 YouTube embed for the default (or env-overridden) Finza demo.
 */
export function FinzaDemoVideoEmbed({
  className,
  title = "How Finza works",
}: FinzaDemoVideoEmbedProps) {
  return (
    <div
      className={cn(
        "aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-xl ring-1 ring-black/5",
        className
      )}
    >
      <iframe
        src={resolveDemoVideoEmbedSrc()}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        className="h-full w-full"
      />
    </div>
  )
}
