/** @type {import('next').NextConfig} */
const PDFKIT_STANDARD_FONT_DATA = './node_modules/pdfkit/js/data/**/*'

const nextConfig = {
  reactStrictMode: true,
  // Ensure ESM-only packages are bundled correctly (avoids "import outside a module" in browser)
  transpilePackages: ['@supabase/ssr', 'next-themes'],
  // Tesseract ships workers/WASM; keep it external so Next does not break resolution
  serverExternalPackages: [
    'tesseract.js',
    'puppeteer-core',
    '@sparticuz/chromium',
    'canvas',
    'pdf-parse',
    'pdfjs-dist',
    // pdfkit loads standard-font .afm files from disk at runtime; keep external on Vercel
    'pdfkit',
  ],
  // NFT does not trace pdfkit's dynamic fs reads; include Helvetica.afm for GL PDF export
  outputFileTracingIncludes: {
    '/api/accounting/reports/general-ledger/export/pdf': [PDFKIT_STANDARD_FONT_DATA],
  },
}

module.exports = nextConfig













