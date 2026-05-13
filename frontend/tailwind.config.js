/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html','./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#080C14',
          900: '#0D1321',
          800: '#111827',
          700: '#1a2235',
        },
        gold: { DEFAULT: '#F0B429', light: '#F6C94E', dark: '#C8920A' },
        success: '#22D3A0',
        danger:  '#F25252',
        warning: '#F59E0B',
      },
      fontFamily: {
        display: ['Orbitron', 'sans-serif'],
        mono:    ['IBM Plex Mono', 'monospace'],
        body:    ['Space Grotesk', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-in':    'fadeIn 0.2s ease-out',
        'spin':       'spin 1s linear infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity:0, transform:'translateY(-4px)' }, '100%': { opacity:1, transform:'translateY(0)' } },
        spin:   { from: { transform:'rotate(0deg)' }, to: { transform:'rotate(360deg)' } },
      },
    },
  },
  plugins: [],
};
