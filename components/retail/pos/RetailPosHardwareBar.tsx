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
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Customer display</h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  This is an 8-digit amount display (numbers only), not a second screen. Chrome will ask you to pick
                  the COM port for this terminal — often COM2 here, but other tills may differ.
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
              <p className="text-[11px] text-slate-500">
                Serial: 9600 baud, 8 data bits, no parity, 1 stop bit, no flow control. A display error never stops a
                sale. The cash drawer is opened by the Windows printer driver when a receipt prints — Finza does not
                connect to the drawer.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
