import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f172a',
        panel: '#1e293b',
        panel2: '#263347',
        line: 'rgba(148, 163, 184, 0.18)',
        cyan: '#25c0f4',
        mint: '#2ff0a2',
        muted: '#94a3b8',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        cyan: '0 18px 60px rgba(37, 192, 244, 0.14)',
      },
    },
  },
  plugins: [],
};

export default config;
