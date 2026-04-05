import { existsSync } from "fs"

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

/**
 * Renders full HTML document string to a PDF buffer (A4, print backgrounds).
 * On Vercel, uses @sparticuz/chromium; locally uses system Chrome/Chromium.
 */
export async function renderHtmlToPdfBuffer(html: string): Promise<Buffer> {
  const puppeteer = (await import("puppeteer-core")).default
  const onVercel = process.env.VERCEL === "1"
  const onLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)

  const browser =
    onVercel || onLambda
      ? await (async () => {
          const chromium = (await import("@sparticuz/chromium")).default
          return puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
          })
        })()
      : await puppeteer.launch({
          executablePath: resolveLocalChromiumExecutablePath(),
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        })

  try {
    const page = await browser.newPage()
    await page.emulateMediaType("print")
    await page.setContent(html, { waitUntil: "load", timeout: 45_000 })
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" },
      scale: 0.88,
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}
