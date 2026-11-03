/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // MLOS core palette — mapped to legacy names so existing components inherit
        navy: {
          950: '#060e1a',   // deep bg
          900: '#0b1829',   // panel bg
          800: '#0d2240',   // elevated surface
          700: '#0f2d55',   // borders / hover
        },
        // Primary accent — MLOS cyan replaces gold
        gold: {
          DEFAULT: '#00d4ff',
          light:   '#33ddff',
          dark:    '#0099cc',
        },
        // Status colors
        success: '#00ff88',
        danger:  '#ff3355',
        warning: '#ffaa00',
        // MLOS-specific extras
        mlos: {
          cyan:    '#00d4ff',
          blue:    '#0066ff',
          electric:'#0044cc',
          muted:   '#4a7090',
          body:    '#c8ddf0',
          bright:  '#e8f4ff',
          panel:   '#0b1829',
          surface: '#0d2240',
          deep:    '#060e1a',
        },
      },
      fontFamily: {
        display: ['Syne', 'Space Grotesk', 'sans-serif'],
        mono:    ['IBM Plex Mono', 'monospace'],
        body:    ['Space Grotesk', 'Inter', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
      },
      animation: {
        'pulse-slow':    'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-in':       'fadeSlideIn 0.2s ease-out',
        'slide-up':      'slideUp 0.25s ease-out',
        'spin':          'spin 1s linear infinite',
        'glow-cyan':     'glowCyan 2s ease-in-out infinite',
        'glow-danger':   'glowDanger 1s ease-in-out infinite',
        'panic-border':  'panicBorder 1.2s ease-in-out infinite',
        'alert-flash':   'alertFlash 2s ease-in-out infinite',
        'count-up':      'countUp 0.4s ease-out',
        'ticker':        'ticker 30s linear infinite',
        'live-pulse':    'livePulse 2s ease-in-out infinite',
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
        glowCyan: {
          '0%, 100%': { boxShadow: '0 0 8px rgba(0,212,255,0.3)' },
          '50%':       { boxShadow: '0 0 24px rgba(0,212,255,0.7), 0 0 48px rgba(0,212,255,0.25)' },
        },
        glowDanger: {
          '0%, 100%': { boxShadow: '0 0 10px rgba(255,51,85,0.3)' },
          '50%':       { boxShadow: '0 0 32px rgba(255,51,85,0.7), 0 0 64px rgba(255,51,85,0.3)' },
        },
        panicBorder: {
          '0%, 100%': { borderColor: 'rgba(255,51,85,0.35)', boxShadow: '0 0 15px rgba(255,51,85,0.15) inset' },
          '50%':       { borderColor: 'rgba(255,51,85,0.8)',  boxShadow: '0 0 40px rgba(255,51,85,0.3) inset, 0 0 60px rgba(255,51,85,0.15)' },
        },
        alertFlash: {
          '0%, 100%': { background: 'transparent' },
          '50%':       { background: 'rgba(255,51,85,0.07)' },
        },
        countUp: {
          '0%':   { opacity: '0', transform: 'scale(0.85)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        ticker: {
          '0%':   { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(-100%)' },
        },
        livePulse: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':       { opacity: '0.4', transform: 'scale(0.8)' },
        },
        spin: {
          from: { transform: 'rotate(0deg)' },
          to:   { transform: 'rotate(360deg)' },
        },
      },
      boxShadow: {
        'glow-cyan':    '0 0 20px rgba(0,212,255,0.35), 0 0 60px rgba(0,212,255,0.12)',
        'glow-gold':    '0 0 20px rgba(0,212,255,0.35), 0 0 60px rgba(0,212,255,0.12)',
        'glow-danger':  '0 0 20px rgba(255,51,85,0.4), 0 0 60px rgba(255,51,85,0.15)',
        'glow-success': '0 0 20px rgba(0,255,136,0.3), 0 0 60px rgba(0,255,136,0.1)',
        'card':         '0 4px 24px rgba(0,0,0,0.5), 0 1px 0 rgba(0,212,255,0.04) inset',
        'card-hover':   '0 8px 40px rgba(0,0,0,0.6), 0 0 24px rgba(0,212,255,0.08)',
      },
    },
  },
  plugins: [],
};
