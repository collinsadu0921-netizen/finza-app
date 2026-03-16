/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Financial Color Semantics
        mj: {
          // Money In (Emerald)
          emerald: {
            100: '#d1fae5',
            500: '#10b981',
            800: '#065f46',
          },
          // Money Out (Slate/Rose)
          slate: {
            100: '#f1f5f9',
            500: '#64748b',
            900: '#0f172a',
          },
          rose: {
            50: '#fff1f2',
            600: '#e11d48',
          },
          // Pending (Gray)
          gray: {
            100: '#f3f4f6',
            400: '#9ca3af',
          },
          // Locked (Amber)
          amber: {
            100: '#fef3c7',
            600: '#d97706',
          },
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
}













