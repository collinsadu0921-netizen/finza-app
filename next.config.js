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
  async redirects() {
    return [
      // Legacy workspace root: redirect at the routing layer so the service
      // layout/sidebar never hydrates for the legacy URL.
      { source: "/service", destination: "/service/services", permanent: false },
    ]
  },
}

module.exports = nextConfig
