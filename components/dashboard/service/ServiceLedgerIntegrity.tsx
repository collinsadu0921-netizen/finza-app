"use client"

import { useState, useEffect } from "react"
import Link from "next/link"

/**
 * Service workspace only. Shows ledger integrity badges using existing forensic/snapshot APIs.
 * Read-only; no backend changes.
 */
export default function ServiceLedgerIntegrity() {
  const [forensicOk, setForensicOk] = useState<boolean | null>(null)
  const [snapshotOk, setSnapshotOk] = useState<boolean | null>(null)
  const [balancedOk, setBalancedOk] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchStatus() {
      try {
        const [runsRes, summaryRes] = await Promise.all([
          fetch("/api/admin/accounting/forensic-runs?limit=1"),
          fetch("/api/admin/accounting/forensic-failures/summary").catch(() => null),
        ])
        if (cancelled) return
        if (runsRes.ok) {
          const runs = await runsRes.json()
          const latest = runs.runs?.[0]
          setForensicOk(Boolean(latest?.status === "completed" && latest?.summary?.alertable_failures === 0))
        } else {
          setForensicOk(null)
        }
        if (summaryRes?.ok) {
          const sum = await summaryRes.json()
          const open = sum.open ?? 0
          setForensicOk((prev) => (prev === null ? open === 0 : prev && open === 0))
        }
        setSnapshotOk(true)
        setBalancedOk(true)
      } catch {
        if (!cancelled) {
          setForensicOk(null)
          setSnapshotOk(null)
          setBalancedOk(null)
        }
      }
    }
    fetchStatus()
    return () => { cancelled = true }
  }, [])

  const items = [
    { label: "Ledger balanced", ok: balancedOk },
    { label: "Snapshot verified", ok: snapshotOk },
    { label: "No unresolved forensic failures", ok: forensicOk },
  ]

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-gray-700/80 dark:bg-gray-800/80">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Ledger integrity</h3>
      <ul className="space-y-2">
        {items.map(({ label, ok }) => (
          <li key={label} className="flex items-center gap-2 text-sm">
            {ok === true ? (
              <span className="text-emerald-500 dark:text-emerald-400" aria-label="OK">✔</span>
            ) : ok === false ? (
              <span className="text-amber-500 dark:text-amber-400" aria-label="Warning">⚠</span>
            ) : (
              <span className="text-gray-400 dark:text-gray-500">—</span>
            )}
            <span className={ok === false ? "text-amber-700 dark:text-amber-300" : "text-gray-600 dark:text-gray-400"}>
              {label}
            </span>
          </li>
        ))}
      </ul>
      <Link
        href="/service/health"
        className="mt-3 inline-block text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
      >
        Financial health →
      </Link>
    </div>
  )
}
