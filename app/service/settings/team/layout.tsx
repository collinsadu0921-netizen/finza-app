"use client"

import TierGate from "@/components/service/TierGate"

export default function ServiceTeamSettingsLayout({ children }: { children: React.ReactNode }) {
  return <TierGate minTier="professional">{children}</TierGate>
}
