import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          0: '#08090b',
          1: '#0e1013',
          2: '#14171b',
          3: '#1b1f24',
          4: '#23282f',
        },
        cds: {
          orange: '#ff7a00',
          'orange-dim': 'rgba(255,122,0,0.15)',
          teal: '#33d6a8',
          'teal-dim': 'rgba(51,214,168,0.12)',
          amber: '#ffb020',
          'amber-dim': 'rgba(255,176,32,0.13)',
          red: '#ff5c5c',
          'red-dim': 'rgba(255,92,92,0.12)',
        },
        text: {
          0: '#f2f3f5',
          1: '#aab0ba',
          2: '#6b7380',
        },
      },
      fontFamily: {
        display: ['Sora', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderColor: {
        hair: 'rgba(255,255,255,0.07)',
        'hair-strong': 'rgba(255,255,255,0.12)',
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.8s infinite',
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-in-right': 'slide-in-right 0.25s ease-out',
        'count-up': 'count-up 0.6s ease-out',
        spin: 'spin 0.8s linear infinite',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
