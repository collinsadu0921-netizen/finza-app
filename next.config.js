/** @type {import('next').NextConfig} */
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
    'pdfkit',
  ],
  // Bundle PDFKit's built-in AFM font metric files (Helvetica.afm, etc.)
  // into the Trial Balance PDF route's serverless tracing output.
  outputFileTracingIncludes: {
    '/api/accounting/reports/trial-balance/export/pdf': [
      './node_modules/pdfkit/js/data/**/*',
    ],
  },
}

module.exports = nextConfig













