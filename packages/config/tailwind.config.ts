import type { Config } from 'tailwindcss';

export default {
  content: ['../../apps/web/src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ZYVORA brand colors
        brand: {
          black: '#0a0a0a',
          gold: '#d4a843',
          'gold-light': '#e8c56d',
          cream: '#fdf8f0',
          'cream-dark': '#f5ebe0',
        },
        accent: {
          red: '#c0392b',
          'red-light': '#e74c3c',
          yellow: '#f39c12',
          'yellow-light': '#f1c40f',
        },
        surface: {
          DEFAULT: '#fdf8f0',
          elevated: '#ffffff',
        },
        text: {
          primary: '#0a0a0a',
          secondary: '#4a4a4a',
          muted: '#888888',
          inverse: '#ffffff',
        },
        border: {
          DEFAULT: '#e8dcc8',
          focus: '#d4a843',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Playfair Display', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        brand: '0 4px 20px rgba(212, 168, 67, 0.15)',
        'brand-lg': '0 10px 40px rgba(212, 168, 67, 0.2)',
      },
    },
  },
  plugins: [],
} satisfies Config;
