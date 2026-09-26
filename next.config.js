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
  async headers() {
    return [
      {
        source: '/ocr/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
}

module.exports = nextConfig
