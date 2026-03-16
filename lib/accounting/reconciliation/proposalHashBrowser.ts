/**
 * Proposal hash in browser (Web Crypto). Must match server proposalHash output.
 */

import { buildProposalHashPayload } from "./proposalHashPayload"
import type { ProposalFixForHash } from "./proposalHashPayload"

export async function proposalHashBrowser(proposed_fix: ProposalFixForHash): Promise<string> {
  const payload = buildProposalHashPayload(proposed_fix)
  const buf = new TextEncoder().encode(payload)
  const hash = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
