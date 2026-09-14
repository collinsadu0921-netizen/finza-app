"use client"

import type { useRetailPosHardware } from "@/components/retail/pos/useRetailPosHardware"

type Hardware = ReturnType<typeof useRetailPosHardware>

export function RetailPosHardwareBar({
  hardware,
  onDrawerResult,
}: {
  hardware: Hardware
  onDrawerResult: (result: { ok: boolean; message?: string }) => void
}) {
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
        title="Customer display and cash drawer"
      >
        {hardware.statusLabel}
      </button>

      {hardware.panelOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Till hardware</h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  The rear display is a 2-line pole display, not a second screen. Chrome must be allowed to use the COM
                  port.
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

            <p className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">{hardware.statusLabel}</p>
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
                  Disconnect display
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

              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Idle message (line 1)
                <input
                  type="text"
                  maxLength={20}
                  value={hardware.idleMessage}
                  onChange={(e) => hardware.saveIdle(e.target.value)}
                  placeholder="THANK YOU"
                  className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 px-3 text-sm font-medium"
                />
              </label>
              <p className="text-[11px] text-slate-500">
                After a sale or cancel, line 2 shows 0.00. Connecting does not start a sale.
              </p>

              <button
                type="button"
                disabled={hardware.busy}
                onClick={async () => {
                  const result = await hardware.openDrawer()
                  onDrawerResult(result)
                }}
                className="min-h-[44px] rounded-xl border-2 border-slate-800 bg-white px-3 text-sm font-bold text-slate-900 disabled:opacity-50"
              >
                Open cash drawer
              </button>
              <p className="text-[11px] text-slate-500">
                The drawer is wired through the receipt printer. This sends an ESC/POS pulse if you can select the
                printer as a serial/COM device. With the XP-80 USB printer driver, set Open cash drawer in Windows
                printer properties instead — Chrome cannot send raw drawer commands through that driver.
              </p>
            </div>

            {hardware.drawerLog.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Recent drawer opens</p>
                <ul className="mt-1 space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                  {hardware.drawerLog.slice(0, 5).map((row) => (
                    <li key={`${row.at}-${row.source}`}>
                      {new Date(row.at).toLocaleString()} · {row.cashier} · {row.source}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
