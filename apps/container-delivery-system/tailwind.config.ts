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
          5: '#2c3139',
        },
        cds: {
          orange: '#ff7a00',
          'orange-dim': 'rgba(255,122,0,0.15)',
          'orange-glow': 'rgba(255,122,0,0.35)',
          teal: '#33d6a8',
          'teal-dim': 'rgba(51,214,168,0.12)',
          amber: '#ffb020',
          'amber-dim': 'rgba(255,176,32,0.13)',
          red: '#ff5c5c',
          'red-dim': 'rgba(255,92,92,0.12)',
          blue: '#5b9aff',
          'blue-dim': 'rgba(91,154,255,0.12)',
        },
        text: {
          0: '#f2f3f5',
          1: '#aab0ba',
          2: '#6b7380',
          3: '#4a5060',
        },
        glass: {
          border: 'rgba(255,255,255,0.07)',
          'border-hover': 'rgba(255,255,255,0.12)',
          'border-strong': 'rgba(255,255,255,0.16)',
        },
      },
      fontFamily: {
        display: ['Sora', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderColor: {
        hair: 'rgba(255,255,255,0.07)',
        'hair-strong': 'rgba(255,255,255,0.12)',
      },
      borderRadius: {
        card: '14px',
        control: '10px',
        badge: '6px',
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
        'xs-tight': ['11px', { lineHeight: '15px' }],
        'sm-tight': ['12.5px', { lineHeight: '18px' }],
      },
      spacing: {
        'page': '1.5rem',
        'page-bottom': '2.5rem',
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.8s infinite',
        'fade-in': 'fade-in 0.25s ease-out',
        'fade-in-up': 'fade-in-up 0.3s ease-out',
        'slide-in-right': 'slide-in-right 0.2s cubic-bezier(0.16,1,0.3,1)',
        'slide-out-right': 'slide-out-right 0.15s ease-in',
        spin: 'spin 0.8s linear infinite',
        shimmer: 'shimmer 1.5s ease-in-out infinite',
        'scale-in': 'scale-in 0.15s ease-out',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-out-right': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      boxShadow: {
        glow: '0 0 12px rgba(255,122,0,0.35)',
        'glow-teal': '0 0 10px rgba(51,214,168,0.6)',
        card: '0 2px 8px rgba(0,0,0,0.25)',
        'card-hover': '0 4px 16px rgba(0,0,0,0.35)',
        drawer: '0 0 40px rgba(0,0,0,0.5)',
        toast: '0 20px 40px -10px rgba(0,0,0,0.65)',
      },
    },
  },
  plugins: [],
} satisfies Config;
