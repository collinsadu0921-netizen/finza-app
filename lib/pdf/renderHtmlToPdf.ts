import { existsSync } from "fs"
import type { Browser } from "puppeteer-core"

/**
 * `@sparticuz/chromium` only inflates `al2.tar.br` / `al2023.tar.br` (NSS shared libs) and prepends
 * `LD_LIBRARY_PATH` when it detects AWS Lambda (`AWS_EXECUTION_ENV`). Vercel does not set that, so
 * Chromium extracts to `/tmp/chromium` without `libnss3.so` → loader error 127.
 * Set a Lambda-shaped value before the first dynamic import so the package behaves as upstream expects.
 */
function ensureSparticuzChromiumEnvForNonLambdaServerless(): void {
  if (process.env.AWS_EXECUTION_ENV) {
    return
  }
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "20", 10)
  if (major >= 22) {
    process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs22.x"
  } else if (major >= 20) {
    process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs20.x"
  } else {
    process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs18.x"
  }
}

function localChromeCandidates(): string[] {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA
    const pf = process.env["PROGRAMFILES"]
    const pf86 = process.env["PROGRAMFILES(X86)"]
    const out: string[] = []
    if (local) {
      out.push(`${local}\\Google\\Chrome\\Application\\chrome.exe`)
    }
    if (pf) {
      out.push(`${pf}\\Google\\Chrome\\Application\\chrome.exe`)
    }
    if (pf86) {
      out.push(`${pf86}\\Google\\Chrome\\Application\\chrome.exe`)
    }
    out.push(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    )
    return out
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]
}

function resolveLocalChromiumExecutablePath(): string {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim()
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv
  }
  for (const p of localChromeCandidates()) {
    if (p && existsSync(p)) {
      return p
    }
  }
  throw new Error(
    "Could not find Chrome/Chromium for PDF export. Install Google Chrome, or set PUPPETEER_EXECUTABLE_PATH to chrome.exe (Windows) or the Chrome binary on macOS/Linux."
  )
}

function browserIsUsable(browser: Browser): boolean {
  const c = browser as Browser & { connected?: boolean }
  if (typeof c.connected === "boolean") {
    return c.connected
  }
  const proc = browser.process()
  if (!proc) return true
  return !proc.killed && proc.exitCode === null
}

/** One Chromium per warm serverless isolate / Node process — avoids multi-second launch per PDF. */
let sharedBrowser: Browser | null = null
let sharedBrowserLaunch: Promise<Browser> | null = null

function clearSharedBrowser(): void {
  sharedBrowser = null
}

function attachDisconnectHandler(browser: Browser): void {
  browser.once("disconnected", () => {
    if (sharedBrowser === browser) {
      clearSharedBrowser()
    }
  })
}

async function launchServerlessBrowser(
  puppeteer: typeof import("puppeteer-core").default
): Promise<Browser> {
  ensureSparticuzChromiumEnvForNonLambdaServerless()
  const chromium = (await import("@sparticuz/chromium")).default
  const executablePath = await chromium.executablePath()
  return puppeteer.launch({
    args: [...chromium.args, "--disable-dev-shm-usage"],
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  })
}

async function launchLocalBrowser(
  puppeteer: typeof import("puppeteer-core").default
): Promise<Browser> {
  return puppeteer.launch({
    executablePath: resolveLocalChromiumExecutablePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
}

async function getOrCreateSharedBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default
  const onVercel = process.env.VERCEL === "1"
  const onLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)

  if (sharedBrowser && browserIsUsable(sharedBrowser)) {
    return sharedBrowser
  }
  if (sharedBrowser && !browserIsUsable(sharedBrowser)) {
    void sharedBrowser.close().catch(() => {
      /* ignore */
    })
  }
  clearSharedBrowser()

  if (!sharedBrowserLaunch) {
    sharedBrowserLaunch = (async () => {
      const browser = onVercel || onLambda ? await launchServerlessBrowser(puppeteer) : await launchLocalBrowser(puppeteer)
      attachDisconnectHandler(browser)
      sharedBrowser = browser
      return browser
    })().finally(() => {
      sharedBrowserLaunch = null
    })
  }

  return sharedBrowserLaunch
}

function isRecoverableBrowserError(message: string): boolean {
  return /Target closed|Session closed|Browser has been closed|Connection closed|Protocol error|WebSocket is not open|Navigation failed because browser has disconnected/i.test(
    message
  )
}

/**
 * Renders full HTML document string to a PDF buffer (A4, print backgrounds).
 * On Vercel, uses @sparticuz/chromium; locally uses system Chrome/Chromium.
 *
 * Reuses one browser per process (warm Vercel isolate) so repeat exports skip Chromium cold start.
 *
 * Vercel: see `ensureSparticuzChromiumEnvForNonLambdaServerless` — required so Sparticuz extracts NSS libs.
 */
export async function renderHtmlToPdfBuffer(html: string): Promise<Buffer> {
  const renderOnce = async (): Promise<Buffer> => {
    const browser = await getOrCreateSharedBrowser()
    const page = await browser.newPage()
    try {
      // Use screen styles for PDF — emulateMediaType("print") applies @media print rules that
      // can clip or omit blocks (e.g. quote terms below totals) in headless Chromium page.pdf().
      await page.emulateMediaType("screen")
      await page.setContent(html, { waitUntil: "load", timeout: 45_000 })
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" },
        scale: 0.88,
      })
      return Buffer.from(pdf)
    } finally {
      await page.close().catch(() => {
        /* ignore */
      })
    }
  }

  try {
    return await renderOnce()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!isRecoverableBrowserError(msg)) {
      throw err
    }
    const dead = sharedBrowser
    clearSharedBrowser()
    if (dead) {
      void dead.close().catch(() => {
        /* ignore */
      })
    }
    return await renderOnce()
  }
}
