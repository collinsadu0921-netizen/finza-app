type PosTerminalSetupHintProps = {
  /** `dark` for full-screen terminal PIN; `light` for legacy light card layouts */
  variant?: "light" | "dark"
}

/**
 * Optional guidance for hiding browser chrome on real registers (Windows + Android).
 */
export function PosTerminalSetupHint({ variant = "light" }: PosTerminalSetupHintProps) {
  if (variant === "dark") {
    return (
      <details className="rounded-xl border border-slate-800 bg-slate-900/50 text-left text-xs text-slate-400">
        <summary className="cursor-pointer select-none px-4 py-3 font-semibold text-slate-300 hover:text-white">
          POS terminal setup — Windows &amp; Android
        </summary>
        <div className="space-y-4 border-t border-slate-800 px-4 pb-4 pt-3">
          <div>
            <p className="font-bold text-slate-200">Windows (Chrome)</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 leading-relaxed">
              <li>
                Use a dedicated Windows user or shortcut that opens Chrome only for your Finza URL (kiosk / &quot;app&quot;
                style window hides most of the address bar).
              </li>
              <li>Search for &quot;Chrome kiosk mode&quot; or your device vendor&apos;s lockdown guide.</li>
            </ul>
          </div>
          <div>
            <p className="font-bold text-slate-200">Android (tablet)</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 leading-relaxed">
              <li>
                In Chrome: menu → <span className="font-semibold text-slate-100">Add to Home screen</span> so Finza opens
                like an app with less browser UI.
              </li>
              <li>
                For a fixed register, use <span className="font-semibold text-slate-100">Screen pinning</span> or your
                tablet&apos;s kiosk / guided access mode.
              </li>
            </ul>
          </div>
        </div>
      </details>
    )
  }

  return (
    <details className="mt-6 rounded-lg border border-gray-200 bg-gray-50/80 text-left text-xs text-gray-600">
      <summary className="cursor-pointer select-none px-3 py-2 font-medium text-gray-700 hover:text-gray-900">
        POS terminal setup — Windows &amp; Android
      </summary>
      <div className="space-y-4 border-t border-gray-200 px-3 pb-3 pt-2">
        <div>
          <p className="font-semibold text-gray-800">Windows (Chrome)</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            <li>
              Use a dedicated Windows user or shortcut that opens Chrome only for your Finza URL (kiosk / &quot;app&quot;
              style window hides most of the address bar).
            </li>
            <li>
              Search for &quot;Chrome kiosk mode&quot; or your device vendor&apos;s lockdown guide for step-by-step
              commands.
            </li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-gray-800">Android (tablet)</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            <li>
              In Chrome: menu → <span className="font-medium">Add to Home screen</span> so Finza opens like an app with
              less browser UI.
            </li>
            <li>
              For a fixed register, use <span className="font-medium">Screen pinning</span> or your tablet&apos;s
              &quot;kiosk / guided access&quot; mode so cashiers stay in one app.
            </li>
          </ul>
        </div>
      </div>
    </details>
  )
}
