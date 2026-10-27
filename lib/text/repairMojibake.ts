/**
 * Repairs text that was decoded with the wrong character set.
 *
 * Two corruptions have appeared in Finza data and source:
 * - UTF-8 bytes decoded as CP850 (Windows/DOS Latin-1). The cedi sign
 *   (U+20B5, UTF-8 `E2 82 B5`) becomes the CP850 sequence `D4 E9 C1`.
 * - UTF-8 bytes decoded as Windows-1252/Latin-1. The same cedi sign becomes
 *   the Windows-1252 sequence `E2 82 B5`.
 *
 * The maps below contain complete, known sequences rather than a generic
 * byte round-trip. That keeps legitimate accented text (`å`, `ä`, `ö`)
 * untouched while still repairing real data at the API/UI boundary.
 */

const CP850_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  // Currency and punctuation
  ["\u00D4\u00E9\u00C1", "\u20B5"], // ₵
  ["\u00D4\u00E9\u00BC", "\u20AC"], // €
  ["\u00D4\u00C7\u00F6", "\u2014"], // —
  ["\u00D4\u00C7\u00F4", "\u2013"], // –
  ["\u00D4\u00C7\u00A3", "\u201C"], // “
  ["\u00D4\u00C7\u00D8", "\u201D"], // ”
  ["\u00D4\u00C7\u00FF", "\u2018"], // ‘
  ["\u00D4\u00C7\u00D6", "\u2019"], // ’
  ["\u00D4\u00C7\u00F3", "\u2022"], // •
  ["\u00D4\u00C7\u00AA", "\u2026"], // …
  ["\u00D4\u00C7\u2591", "\u2030"], // ‰
  ["\u00D4\u00C7\u00E1", "\u2020"], // †
  // Arrows and status glyphs
  ["\u00D4\u00E5\u00C6", "\u2192"], // →
  ["\u00D4\u00E5\u00C9", "\u2190"], // ←
  ["\u00D4\u00E5\u00E6", "\u2191"], // ↑
  ["\u00D4\u00E5\u00F4", "\u2193"], // ↓
  ["\u00D4\u00E5\u2557", "\u21BB"], // ↻
  ["\u00D4\u00A3\u00F4", "\u2713"], // ✓
  ["\u00D4\u00A3\u00F6", "\u2714"], // ✔
  ["\u00D4\u00A3\u00F9", "\u2717"], // ✗
  ["\u00D4\u00DC\u00E1", "\u26A0"], // ⚠
  // Common Latin-1 characters when the source was CP850
  ["\u252C\u00C0", "\u00B7"], // ·
  ["\u252C\u00FA", "\u00A3"], // £
  ["\u252C\u00AE", "\u00A9"], // ©
  ["\u252C\u00AB", "\u00AE"], // ®
  ["\u252C\u2591", "\u00B0"], // °
  ["\u252C\u00E1", "\u00A0"], // non-breaking space
  ["\u251C\u00E4", "\u00C4"], // Ä
  ["\u251C\u00FB", "\u00D6"], // Ö
  ["\u251C\u00A3", "\u00DC"], // Ü
  ["\u251C\u00F1", "\u00E4"], // ä
  ["\u251C\u00C2", "\u00F6"], // ö
  ["\u251C\u255D", "\u00FC"], // ü
  ["\u251C\u0192", "\u00DF"], // ß
  ["\u251C\u00D1", "\u00E5"], // å
  ["\u251C\u00AE", "\u00E9"], // é
]

const WINDOWS_1252_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["\u00E2\u201A\u00B5", "\u20B5"], // ₵
  ["\u00E2\u201A\u00AC", "\u20AC"], // €
  ["\u00E2\u20AC\u201D", "\u2014"], // —
  ["\u00E2\u20AC\u201C", "\u2013"], // –
  ["\u00E2\u20AC\u0153", "\u201C"], // “
  ["\u00E2\u20AC\u009D", "\u201D"], // ”
  ["\u00E2\u20AC\uFFFD", "\u201D"], // ” (replacement-character variant)
  ["\u00E2\u20AC\u02DC", "\u2018"], // ‘
  ["\u00E2\u20AC\u2122", "\u2019"], // ’
  ["\u00E2\u20AC\u00A2", "\u2022"], // •
  ["\u00E2\u20AC\u00A6", "\u2026"], // …
  ["\u00E2\u2020\u2019", "\u2192"], // →
  ["\u00E2\u2020\u0090", "\u2190"], // ←
  ["\u00E2\u2020\uFFFD", "\u2190"], // ← (replacement-character variant)
  ["\u00C3\u00A9", "\u00E9"], // é
  ["\u00C3\u00A4", "\u00E4"], // ä
  ["\u00C3\u00B6", "\u00F6"], // ö
  ["\u00C3\u00BC", "\u00FC"], // ü
  ["\u00C3\u00A5", "\u00E5"], // å
  ["\u00C3\u0178", "\u00DF"], // ß
  ["\u00C3\u201E", "\u00C4"], // Ä
  ["\u00C3\u2013", "\u00D6"], // Ö
  ["\u00C3\u0153", "\u00DC"], // Ü
  ["\u00C2\u00A3", "\u00A3"], // £
  ["\u00C2\u00A9", "\u00A9"], // ©
  ["\u00C2\u00AE", "\u00AE"], // ®
  ["\u00C2\u00B0", "\u00B0"], // °
  ["\u00C2\u00B7", "\u00B7"], // ·
  ["\u00C2\u00A0", "\u00A0"], // non-breaking space
]

const ALL_REPLACEMENTS = [...CP850_REPLACEMENTS, ...WINDOWS_1252_REPLACEMENTS].sort(
  ([a], [b]) => b.length - a.length
)

/** True when `text` contains a known mojibake sequence. */
export function containsMojibake(text: string | null | undefined): boolean {
  if (!text) return false
  return ALL_REPLACEMENTS.some(([corrupt]) => text.includes(corrupt))
}

/**
 * Repairs known mojibake sequences in a string.
 *
 * Safe to call on already-correct text; it only replaces exact sequences that
 * could not have come from legitimate UTF-8 source.
 */
export function repairMojibake(text: string): string {
  if (!text) return text
  let repaired = text
  // Two passes handle values that were decoded twice (e.g. console → file → DB).
  for (let pass = 0; pass < 2; pass += 1) {
    let changed = false
    for (const [corrupt, correct] of ALL_REPLACEMENTS) {
      if (!repaired.includes(corrupt)) continue
      repaired = repaired.split(corrupt).join(correct)
      changed = true
    }
    if (!changed) break
  }
  return repaired
}
