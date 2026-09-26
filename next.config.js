/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@supabase/ssr', 'next-themes', '@paddleocr/paddleocr-js'],
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
  // Next 16 builds with Turbopack. The webpack hook stays for `next dev --webpack`,
  // which is what local OCR development uses. An empty Turbopack block keeps
  // `next build` from refusing the webpack hook.
  turbopack: {
    resolveAlias: {
      fs: { browser: "./lib/ocr/emptyModule.js" },
      path: { browser: "./lib/ocr/emptyModule.js" },
      crypto: { browser: "./lib/ocr/emptyModule.js" },
    },
  },
  webpack: (config, { isServer, dev }) => {
    const path = require("path")
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        path: false,
        module: false,
      }
    }
    config.plugins.push({
      apply(compiler) {
        compiler.hooks.normalModuleFactory.tap("finza-node-scheme", (nmf) => {
          nmf.hooks.beforeResolve.tap("finza-node-scheme", (resolveData) => {
            if (resolveData?.request?.startsWith("node:")) {
              resolveData.request = resolveData.request.slice(5)
            }
          })
        })
      },
    })
    if (dev) {
      // The PaddleOCR worker is emitted as a static asset. Next's React Refresh
      // transform appends $RefreshReg$ calls, and a worker has no refresh runtime.
      config.module.rules.push({
        test: /[\\/]@paddleocr[\\/]paddleocr-js[\\/].*worker-entry-.*\.js$/,
        enforce: "post",
        use: [path.join(__dirname, "lib/ocr/stripRefreshForWorker.cjs")],
      })
    }
    return config
  },
}

module.exports = nextConfig













