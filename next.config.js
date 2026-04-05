/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ensure ESM-only packages are bundled correctly (avoids "import outside a module" in browser)
  transpilePackages: ['@supabase/ssr', 'next-themes'],
  // Tesseract ships workers/WASM; keep it external so Next does not break resolution
  serverExternalPackages: ['tesseract.js', 'puppeteer-core', '@sparticuz/chromium'],
}

module.exports = nextConfig













