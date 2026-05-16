/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#080C14', 900: '#0D1321', 800: '#111827', 700: '#1a2235' },
        gold: { DEFAULT: '#F0B429', light: '#F6C94E', dark: '#C8920A' },
        success: '#22D3A0',
        danger: '#F25252',
        warning: '#F59E0B',
      },
      fontFamily: {
        display: ['Orbitron', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
        body: ['Space Grotesk', 'sans-serif'],
      },
      animation: {
        'pulse-slow':   'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-in':      'fadeSlideIn 0.2s ease-out',
        'slide-up':     'slideUp 0.25s ease-out',
        'spin':         'spin 1s linear infinite',
        'glow-gold':    'glowGold 2s ease-in-out infinite',
        'glow-danger':  'glowDanger 1s ease-in-out infinite',
        'panic-border': 'panicBorder 1.2s ease-in-out infinite',
        'alert-flash':  'alertFlash 2s ease-in-out infinite',
        'count-up':     'countUp 0.4s ease-out',
      },
      keyframes: {
        fadeSlideIn: {
          '0%':   { opacity: '0', transform: 'translateY(-6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        glowGold: {
          '0%, 100%': { boxShadow: '0 0 8px rgba(240,180,41,0.25)' },
          '50%':       { boxShadow: '0 0 24px rgba(240,180,41,0.6), 0 0 48px rgba(240,180,41,0.2)' },
        },
        glowDanger: {
          '0%, 100%': { boxShadow: '0 0 10px rgba(242,82,82,0.3)' },
          '50%':       { boxShadow: '0 0 32px rgba(242,82,82,0.7), 0 0 64px rgba(242,82,82,0.25)' },
        },
        panicBorder: {
          '0%, 100%': { borderColor: 'rgba(242,82,82,0.35)', boxShadow: '0 0 15px rgba(242,82,82,0.15) inset' },
          '50%':       { borderColor: 'rgba(242,82,82,0.8)',  boxShadow: '0 0 40px rgba(242,82,82,0.3) inset, 0 0 60px rgba(242,82,82,0.15)' },
        },
        alertFlash: {
          '0%, 100%': { background: 'transparent' },
          '50%':       { background: 'rgba(242,82,82,0.07)' },
        },
        countUp: {
          '0%':   { opacity: '0', transform: 'scale(0.85)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        spin: {
          from: { transform: 'rotate(0deg)' },
          to:   { transform: 'rotate(360deg)' },
        },
      },
      boxShadow: {
        'glow-gold':    '0 0 20px rgba(240,180,41,0.3), 0 0 60px rgba(240,180,41,0.1)',
        'glow-danger':  '0 0 20px rgba(242,82,82,0.4), 0 0 60px rgba(242,82,82,0.15)',
        'glow-success': '0 0 20px rgba(34,211,160,0.3), 0 0 60px rgba(34,211,160,0.1)',
        'card':         '0 4px 20px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.035) inset',
        'card-hover':   '0 8px 40px rgba(0,0,0,0.5), 0 0 24px rgba(240,180,41,0.07)',
      },
    },
  },
  plugins: [],
};
