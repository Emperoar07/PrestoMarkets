import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#090e1a',
        panel: '#141e30',
        panel2: '#0f172a',
        line: 'rgba(255, 255, 255, 0.06)',
        cyan: '#25c0f4',
        mint: '#2ff0a2',
        muted: '#94a3b8',
        deepmuted: '#4b6280',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        cyan: '0 8px 28px rgba(37, 192, 244, 0.20)',
      },
    },
  },
  plugins: [],
};

export default config;
