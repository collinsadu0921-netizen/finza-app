"use client"

import type { useRetailPosHardware } from "@/components/retail/pos/useRetailPosHardware"

type Hardware = ReturnType<typeof useRetailPosHardware>

export function RetailPosHardwareBar({ hardware }: { hardware: Hardware }) {
  return (
    <>
      <button
        type="button"
        onClick={() => hardware.setPanelOpen(true)}
        className={`inline-flex shrink-0 items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
          hardware.status === "connected"
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : hardware.status === "error"
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-slate-200 bg-slate-50 text-slate-600"
        }`}
        title="Customer amount display"
      >
        {hardware.cashierStatusLabel}
      </button>

      {hardware.panelOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Customer display</h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  Rear numeric amount display for this till. Chrome asks you to pick the serial port — never hardcoded.
                  Display errors never stop a sale. Cash drawer opens via the Windows printer driver, not Finza.
                </p>
              </div>
              <button
                type="button"
                onClick={() => hardware.setPanelOpen(false)}
                className="min-h-[44px] rounded-md px-3 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100"
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
              {hardware.liveTrialActive
                ? " · live trial on (this till)"
                : hardware.status === "connected" && !hardware.autoUpdatesAllowed && !hardware.diagnosticMode
                  ? " · automatic totals off (not verified)"
                  : ""}
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
                  className="min-h-[48px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 disabled:opacity-50"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  disabled={hardware.busy}
                  onClick={() => void hardware.connect()}
                  className="min-h-[48px] rounded-xl bg-blue-600 px-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  {hardware.busy ? "Connecting…" : "Connect customer display"}
                </button>
              )}
              <p className="text-[11px] text-slate-500">
                Connecting never sends bytes by itself. Any amount already on the rear display after Connect is leftover
                hardware state, not a Finza write.
              </p>
            </div>

            {hardware.canUseDiagnostics ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                  <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">This till’s display setup</h3>
                  <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                    Profile is saved for this bound register only. Other tills keep their own settings. Do not mark
                    verified until amounts look correct on the physical rear display.
                  </p>

                  {!hardware.hasTerminalBinding ? (
                    <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-950">
                      Bind this browser to a register first so the display profile stays on this physical till.
                    </p>
                  ) : null}

                  <label className="mt-3 block text-[11px] font-bold text-slate-800 dark:text-slate-200">
                    Serial profile (candidate)
                    <select
                      className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-semibold text-slate-900"
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

                  <label className="mt-3 block text-[11px] font-bold text-slate-800 dark:text-slate-200">
                    Staging candidate amount write (this till)
                    <select
                      className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-semibold text-slate-900"
                      value={hardware.amountWriteMode}
                      disabled={hardware.busy || !hardware.hasTerminalBinding}
                      onChange={(e) =>
                        hardware.saveAmountWriteMode(
                          e.target.value as "ascii_only" | "clear_then_amount"
                        )
                      }
                    >
                      <option value="ascii_only">Plain ASCII overwrite (default)</option>
                      <option
                        value="clear_then_amount"
                        disabled={!hardware.canSelectClearThenAmount}
                      >
                        Clear then amount (0C) — 2400 only
                      </option>
                    </select>
                  </label>
                  <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">
                    {hardware.amountWriteModeWarning}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                    Saving a write mode does not mark verified and does not turn on automatic totals. Use{" "}
                    <strong>Trial live totals</strong> to exercise 0C→ASCII without verification. Required profile:{" "}
                    {hardware.clearThenAmountRequiredProfileId}.
                  </p>

                  <p className="mt-2 text-[11px] text-slate-700 dark:text-slate-300">
                    Verification:{" "}
                    {hardware.terminalConfig.physicallyVerified ? (
                      <span className="font-bold text-emerald-700">Physically verified</span>
                    ) : (
                      <span className="font-bold text-amber-800">Not verified — automatic totals off</span>
                    )}
                  </p>
                  {hardware.terminalConfig.verifiedNote ? (
                    <p className="mt-1 text-[10px] text-slate-500">{hardware.terminalConfig.verifiedNote}</p>
                  ) : null}
                  {hardware.terminalConfig.verifiedAt ? (
                    <p className="text-[10px] text-slate-400">{hardware.terminalConfig.verifiedAt}</p>
                  ) : null}

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      disabled={hardware.busy || !hardware.hasTerminalBinding}
                      onClick={() => hardware.markPhysicallyVerified()}
                      className="min-h-[48px] flex-1 rounded-xl bg-slate-900 px-3 text-sm font-bold text-white disabled:opacity-50"
                    >
                      Mark physically verified
                    </button>
                    <button
                      type="button"
                      disabled={hardware.busy || !hardware.terminalConfig.physicallyVerified}
                      onClick={() => hardware.clearPhysicalVerification()}
                      className="min-h-[48px] flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 disabled:opacity-50"
                    >
                      Clear verification
                    </button>
                  </div>
                  {hardware.configMessage ? (
                    <p className="mt-2 text-[11px] font-semibold text-slate-700">{hardware.configMessage}</p>
                  ) : null}
                </div>

                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
                  <h3 className="text-sm font-extrabold text-amber-950 dark:text-amber-100">
                    Trial live totals on this till
                  </h3>
                  <p className="mt-1 text-[11px] font-semibold text-amber-950 dark:text-amber-100">
                    Owner/admin only · staging physical test · separate from Mark physically verified
                  </p>
                  <p className="mt-2 text-[11px] text-amber-900 dark:text-amber-200">{hardware.liveTrialWarning}</p>
                  <p className="mt-2 text-[11px] text-amber-900 dark:text-amber-200">
                    Requires: bound till · connected display · selected {hardware.liveTrialRequiredProfileId} profile ·
                    diagnostic mode off. Defaults off; stops on reload, disconnect, or write failure. Does not use a
                    saved verification flag.
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    {hardware.liveTrialActive ? (
                      <button
                        type="button"
                        disabled={hardware.busy}
                        onClick={() => hardware.stopLiveTrial()}
                        className="min-h-[48px] flex-1 rounded-xl border border-amber-700 bg-white px-3 text-sm font-bold text-amber-950 disabled:opacity-50"
                      >
                        Stop live trial
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={hardware.busy || !hardware.liveTrialStartGate.ok}
                        onClick={() => hardware.startLiveTrial()}
                        className="min-h-[48px] flex-1 rounded-xl bg-amber-800 px-3 text-sm font-bold text-white disabled:opacity-50"
                      >
                        Start trial live totals
                      </button>
                    )}
                  </div>
                  {!hardware.liveTrialActive && hardware.liveTrialStartGate.reason ? (
                    <p className="mt-2 text-[11px] font-semibold text-amber-900">
                      Cannot start: {hardware.liveTrialStartGate.reason}
                    </p>
                  ) : null}
                  {hardware.liveTrialMessage ? (
                    <p className="mt-2 text-[11px] font-semibold text-amber-950">{hardware.liveTrialMessage}</p>
                  ) : null}
                  {hardware.liveTrialActive ? (
                    <p className="mt-2 text-[11px] font-bold text-amber-950">
                      Live trial ON — basket/checkout totals send 0C then ASCII on this till only.
                    </p>
                  ) : null}
                </div>

                <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">Advanced diagnostics</h3>
                    <button
                      type="button"
                      className="min-h-[44px] rounded-md border border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-800"
                      onClick={() => hardware.setAdvancedOpen(!hardware.advancedOpen)}
                    >
                      {hardware.advancedOpen ? "Hide" : "Show"}
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                    Manual one-shot writes for baud discovery. Log “OK” means Finza wrote bytes — not that the rear
                    display rendered correctly.
                  </p>

                  {hardware.advancedOpen ? (
                    <div className="mt-3 space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        {hardware.diagnosticMode ? (
                          <button
                            type="button"
                            disabled={hardware.busy}
                            onClick={() => void hardware.disableDiagnostics()}
                            className="min-h-[48px] flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 disabled:opacity-50"
                          >
                            Exit diagnostic mode
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={hardware.busy}
                            onClick={() => void hardware.enableDiagnostics()}
                            className="min-h-[48px] flex-1 rounded-xl bg-slate-800 px-3 text-sm font-bold text-white disabled:opacity-50"
                          >
                            Enter diagnostic mode
                          </button>
                        )}
                      </div>

                      {!hardware.diagnosticMode ? (
                        <p className="text-[11px] text-slate-600">
                          Enter diagnostic mode before Send. That pauses automatic basket/total writes so tests are not
                          overwritten.
                        </p>
                      ) : (
                        <>
                          <p className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-800">
                            {hardware.powerCycleHint}
                          </p>
                          <p className="text-[11px] text-slate-600">
                            Suggested order on this Windows 7 till: Connect → confirm hex → Send <strong>ASCII 0.00</strong>{" "}
                            once → then try other amounts. Do not mark verified until different amounts look correct after
                            fresh connects.
                          </p>

                          <div>
                            <p className="mb-1 text-[11px] font-bold text-slate-800">Outgoing bytes (hex) before send</p>
                            <code className="block break-all rounded-lg border border-slate-200 bg-white px-2 py-2 font-mono text-[11px] text-slate-800">
                              {hardware.lastHexPreview || "—"}
                            </code>
                            <p className="mt-1 text-[10px] text-slate-500">
                              Pending: {hardware.pendingTest.name}
                              {hardware.pendingTest.rawBytes ? (
                                <>
                                  {" "}
                                  → raw{" "}
                                  <span className="font-mono">{hardware.lastHexPreview || "—"}</span>
                                </>
                              ) : (
                                <>
                                  {" "}
                                  → ASCII{" "}
                                  <span className="font-mono">{JSON.stringify(hardware.pendingTest.ascii)}</span>
                                </>
                              )}
                            </p>
                          </div>

                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {hardware.tests
                              .filter((t) => t.id !== "candidate_clear_0c")
                              .map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                disabled={hardware.busy || hardware.status !== "connected"}
                                onMouseEnter={() => hardware.previewDiagnosticTest(t.id)}
                                onFocus={() => hardware.previewDiagnosticTest(t.id)}
                                onClick={() => void hardware.runDiagnosticTest(t.id)}
                                className="min-h-[52px] rounded-xl border border-slate-300 bg-white px-3 text-left text-xs font-bold text-slate-900 disabled:opacity-50"
                              >
                                Send {t.name}
                                <span className="mt-0.5 block font-mono text-[10px] font-normal text-slate-600">
                                  {JSON.stringify(t.ascii)}
                                </span>
                              </button>
                            ))}
                          </div>

                          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
                            <p className="text-[11px] font-semibold text-amber-950">
                              Unverified for this display. Sends one byte once; the panel may not clear and may show an
                              unexpected character.
                            </p>
                            <p className="mt-1 text-[10px] text-amber-900/80">
                              Look-alike LED8 docs list <span className="font-mono">0C</span> as clear — not confirmed for
                              this till. Not a protocol fix. Log “OK” only means the write completed.
                            </p>
                            <button
                              type="button"
                              disabled={hardware.busy || hardware.status !== "connected" || !hardware.diagnosticMode}
                              onMouseEnter={() => hardware.previewDiagnosticTest("candidate_clear_0c")}
                              onFocus={() => hardware.previewDiagnosticTest("candidate_clear_0c")}
                              onClick={() => void hardware.runDiagnosticTest("candidate_clear_0c")}
                              className="mt-2 min-h-[52px] w-full rounded-xl border border-amber-400 bg-white px-3 text-left text-xs font-bold text-amber-950 disabled:opacity-50"
                            >
                              Test candidate clear (0C)
                              <span className="mt-0.5 block font-mono text-[10px] font-normal text-slate-600">
                                hex preview → 0C
                              </span>
                            </button>
                          </div>

                          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
                            <p className="text-[11px] font-extrabold text-amber-950">
                              Candidate: clear once, then amount once
                            </p>
                            <p className="mt-1 text-[11px] font-semibold text-amber-950">
                              {hardware.clearThenAmountWarning}
                            </p>
                            <label className="mt-2 block text-[11px] font-bold text-amber-950">
                              Amount ASCII (max 8; digits and optional .)
                              <input
                                type="text"
                                inputMode="decimal"
                                value={hardware.sequenceAmountInput}
                                disabled={hardware.busy}
                                onChange={(e) => hardware.setSequenceAmountInput(e.target.value)}
                                className="mt-1 min-h-[44px] w-full rounded-lg border border-amber-300 bg-white px-2 py-2 font-mono text-sm text-slate-900"
                                placeholder="1234.56"
                                maxLength={8}
                              />
                            </label>
                            <p className="mt-2 text-[10px] font-bold text-amber-950">Outgoing sequence (hex) before send</p>
                            <code className="mt-0.5 block break-all rounded-lg border border-amber-200 bg-white px-2 py-2 font-mono text-[11px] text-slate-800">
                              {hardware.clearThenAmountPreview.clearHex}
                              {hardware.clearThenAmountPreview.amountHex
                                ? ` → ${hardware.clearThenAmountPreview.amountHex}`
                                : " → (enter a valid amount)"}
                            </code>
                            {!hardware.clearThenAmountPreview.valid && hardware.sequenceAmountInput.trim() ? (
                              <p className="mt-1 text-[10px] text-red-700">{hardware.clearThenAmountPreview.error}</p>
                            ) : null}
                            <button
                              type="button"
                              disabled={
                                hardware.busy ||
                                hardware.status !== "connected" ||
                                !hardware.diagnosticMode ||
                                !hardware.clearThenAmountPreview.valid
                              }
                              onClick={() => void hardware.runClearThenAmount()}
                              className="mt-2 min-h-[52px] w-full rounded-xl border border-amber-400 bg-white px-3 text-sm font-bold text-amber-950 disabled:opacity-50"
                            >
                              Send clear then amount (once each)
                            </button>
                            {hardware.sequenceMessage ? (
                              <p className="mt-2 text-[10px] font-semibold text-slate-700">{hardware.sequenceMessage}</p>
                            ) : null}
                          </div>

                          {hardware.diagnosticLog.length > 0 ? (
                            <div>
                              <p className="mb-1 text-[11px] font-bold text-slate-800">Local diagnostic log</p>
                              <ul className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 text-[10px] text-slate-700">
                                {hardware.diagnosticLog.slice(0, 8).map((entry, idx) => (
                                  <li
                                    key={`${entry.timestamp}-${idx}`}
                                    className="border-b border-slate-100 pb-1 last:border-0"
                                  >
                                    <span className={entry.ok ? "text-emerald-700" : "text-red-700"}>
                                      {entry.ok ? "OK" : "ERR"}
                                    </span>{" "}
                                    {entry.baudRate} baud · {entry.testName} · {entry.bytesHex}
                                    <span className="block text-slate-400">{entry.timestamp}</span>
                                    {entry.error ? (
                                      <span className="block text-red-600">{entry.error}</span>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
