/**
 * Canonical “how Finza works” product demo for /demo, /signup, and login link targets.
 * Override with NEXT_PUBLIC_DEMO_VIDEO_URL (YouTube watch, youtu.be, or embed URL).
 */

export const DEFAULT_FINZA_DEMO_VIDEO_URL = "https://www.youtube.com/watch?v=ScD8LXyYcTw"

export function resolveDemoVideoWatchUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL?.trim()
  return fromEnv || DEFAULT_FINZA_DEMO_VIDEO_URL
}

/** Safe embed `src` for YouTube watch / short / embed links. */
export function resolveDemoVideoEmbedSrc(): string {
  const raw = resolveDemoVideoWatchUrl()

  if (raw.includes("youtube.com/embed/")) {
    const base = raw.split("?")[0] ?? raw
    return base
  }

  const watchMatch = raw.match(/[?&]v=([^&]+)/)
  if (raw.includes("youtube.com/watch") && watchMatch?.[1]) {
    return `https://www.youtube.com/embed/${watchMatch[1]}`
  }

  const shortMatch = raw.match(/youtu\.be\/([^?&#]+)/)
  if (shortMatch?.[1]) {
    return `https://www.youtube.com/embed/${shortMatch[1]}`
  }

  return raw
}
