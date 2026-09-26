/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@supabase/ssr', 'next-themes'],
  serverExternalPackages: [
    'puppeteer-core',
    '@sparticuz/chromium',
    'pdf-parse',
    'pdfjs-dist',
  ],
}

module.exports = nextConfig
