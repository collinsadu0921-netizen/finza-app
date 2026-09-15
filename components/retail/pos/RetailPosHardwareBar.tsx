"use client"

import type { useRetailPosHardware } from "@/components/retail/pos/useRetailPosHardware"

type Hardware = ReturnType<typeof useRetailPosHardware>

export function RetailPosHardwareBar({ hardware }: { hardware: Hardware }) {
  return (
    <>
      <button
        type="button"
        onClick={() => hardware.setPanelOpen(true)}
        className={`inline-flex shrink-0 items-center whitespace-nowrap rounded border px-1.5 py-0.5 ${
          hardware.status === "connected"
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : hardware.status === "error"
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-slate-200 bg-slate-50 text-slate-600"
        }`}
        title="Customer amount display"
      >
        {hardware.statusLabel}
      </button>

      {hardware.panelOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Customer display</h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  This is an 8-digit amount display (numbers only), not a second screen. Chrome will ask you to pick
                  the COM port for this terminal — often COM2 here, but other tills may differ. Never hardcode the
                  port; always choose it in the browser picker.
                </p>
              </div>
              <button
                type="button"
                onClick={() => hardware.setPanelOpen(false)}
                className="rounded-md px-2 py-1 text-sm font-bold text-slate-500 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <p className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-200">{hardware.statusLabel}</p>
            <p className="mb-3 text-[11px] text-slate-500">
              Status:{" "}
              {hardware.status === "connected"
                ? "connected"
                : hardware.status === "error"
                  ? "error"
                  : "off"}
              {hardware.baudRate != null ? ` · ${hardware.baudRate} baud` : ""}
            </p>
            {hardware.lastError ? (
              <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {hardware.lastError}
              </p>
            ) : null}

            <div className="flex flex-col gap-2">
              {hardware.status === "connected" ? (
                <button
                  type="button"
                  disabled={hardware.busy}
                  onClick={() => void hardware.disconnect()}
                  className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 disabled:opacity-50"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  disabled={hardware.busy}
                  onClick={() => void hardware.connect()}
                  className="min-h-[44px] rounded-xl bg-blue-600 px-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  {hardware.busy ? "Connecting…" : "Connect customer display"}
                </button>
              )}
              <p className="text-[11px] text-slate-500">
                Connecting never sends bytes by itself. A display error never stops a sale. The cash drawer is opened
                by the Windows printer driver when a receipt prints — Finza does not connect to the drawer.
              </p>
            </div>

            {hardware.canUseDiagnostics ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-extrabold text-amber-950 dark:text-amber-100">
                    Customer Display Diagnostic
                  </h3>
                  {hardware.diagnosticMode ? (
                    <button
                      type="button"
                      disabled={hardware.busy}
                      onClick={() => void hardware.disableDiagnostics()}
                      className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-bold text-amber-900 disabled:opacity-50"
                    >
                      Exit diagnostic
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={hardware.busy}
                      onClick={() => void hardware.enableDiagnostics()}
                      className="rounded-md bg-amber-700 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                    >
                      Enter diagnostic
                    </button>
                  )}
                </div>

                {!hardware.diagnosticMode ? (
                  <p className="text-[11px] text-amber-900/80 dark:text-amber-100/80">
                    Retail admin only. Turns off automatic basket/total updates so Finza does not compete while you
                    test baud rates. Start physical testing at <strong>2400 baud</strong> with <strong>0.00</strong>.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <p className="rounded-md border border-amber-300 bg-white/70 px-2 py-1.5 text-[11px] font-semibold text-amber-950">
                      {hardware.powerCycleHint}
                    </p>

                    <label className="block text-[11px] font-bold text-amber-950 dark:text-amber-100">
                      Serial profile
                      <select
                        className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-2 py-2 text-sm font-semibold text-slate-900"
                        value={hardware.profileId}
                        disabled={hardware.busy}
                        onChange={(e) =>
                          void hardware.applyProfile(
                            e.target.value as (typeof hardware.profiles)[number]["id"]
                          )
                        }
                      >
                        {hardware.profiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div>
                      <p className="mb-1 text-[11px] font-bold text-amber-950 dark:text-amber-100">
                        Outgoing bytes (hex) — shown before send
                      </p>
                      <code className="block break-all rounded-lg border border-amber-200 bg-white px-2 py-2 font-mono text-[11px] text-slate-800">
                        {hardware.lastHexPreview || "—"}
                      </code>
                      <p className="mt-1 text-[10px] text-amber-900/70">
                        Pending test: {hardware.pendingTest.name} → ASCII{" "}
                        <span className="font-mono">{JSON.stringify(hardware.pendingTest.ascii)}</span>
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {hardware.tests.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          disabled={hardware.busy || hardware.status !== "connected"}
                          onMouseEnter={() => hardware.previewDiagnosticTest(t.id)}
                          onFocus={() => hardware.previewDiagnosticTest(t.id)}
                          onClick={() => void hardware.runDiagnosticTest(t.id)}
                          className="min-h-[44px] rounded-xl border border-amber-300 bg-white px-3 text-left text-xs font-bold text-amber-950 disabled:opacity-50"
                        >
                          Send {t.name}
                          <span className="mt-0.5 block font-mono text-[10px] font-normal text-slate-600">
                            {JSON.stringify(t.ascii)}
                          </span>
                        </button>
                      ))}
                    </div>

                    {hardware.diagnosticLog.length > 0 ? (
                      <div>
                        <p className="mb-1 text-[11px] font-bold text-amber-950">Local diagnostic log</p>
                        <ul className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-amber-200 bg-white p-2 text-[10px] text-slate-700">
                          {hardware.diagnosticLog.slice(0, 8).map((entry, idx) => (
                            <li key={`${entry.timestamp}-${idx}`} className="border-b border-slate-100 pb-1 last:border-0">
                              <span className={entry.ok ? "text-emerald-700" : "text-red-700"}>
                                {entry.ok ? "OK" : "ERR"}
                              </span>{" "}
                              {entry.baudRate} baud · {entry.testName} · {entry.bytesHex}
                              <span className="block text-slate-400">{entry.timestamp}</span>
                              {entry.error ? <span className="block text-red-600">{entry.error}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
