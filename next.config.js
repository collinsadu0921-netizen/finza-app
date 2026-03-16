/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ensure ESM-only packages are bundled correctly (avoids "import outside a module" in browser)
  transpilePackages: ['@supabase/ssr', 'next-themes'],
}

module.exports = nextConfig













