import type { Config } from 'tailwindcss';

const d = (v: string) => `var(--d-${v})`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'd-void': d('void'),
        'd-carbon': d('carbon'),
        'd-deep': d('deep'),
        'd-well': d('well'),
        'd-surf': d('surf'),
        'd-lift': d('lift'),
        'd-lift2': d('lift2'),
        'd-sig': d('sig'),
        'd-sig2': d('sig2'),
        'd-sig3': d('sig3'),
        'd-sg': d('sg'),
        'd-sg2': d('sg2'),
        'd-fire': d('fire'),
        'd-fg': d('fg'),
        'd-warn': d('warn'),
        'd-wg': d('wg'),
        'd-ok': d('ok'),
        'd-okg': d('okg'),
        'd-purple': d('purple'),
        'd-t1': d('t1'),
        'd-t2': d('t2'),
        'd-t3': d('t3'),
        'd-t4': d('t4'),
        'd-rim': d('rim'),
        'd-rim2': d('rim2'),
        'd-rim3': d('rim3'),
        // CDS tokens
        'ink-0': '#08090b',
        'ink-1': '#0f1114',
        'ink-2': '#16181d',
        'ink-3': '#1e2128',
        'ink-4': '#262a33',
        'text-0': '#ffffff',
        'text-1': 'rgba(255,255,255,0.85)',
        'text-2': 'rgba(255,255,255,0.45)',
        'cds-orange': '#ff7a00',
        'cds-teal': '#33d6a8',
        'cds-amber': '#ffb020',
        'cds-red': '#ff5c5c',
        // Port's accent — already used ad hoc as a raw #37e6ff literal in
        // BookingManifest (YARD_COLOR.inbound), CDSBookings (LIFECYCLE
        // Dispatched/In Transit) and the field app. Named here so those spots
        // and the field app can share one token instead of repeating the hex.
        'cds-cyan': '#37e6ff',
        'cds-orange-dim': 'rgba(255,122,0,0.12)',
        'cds-teal-dim': 'rgba(51,214,168,0.12)',
        'cds-amber-dim': 'rgba(255,176,32,0.12)',
        'cds-red-dim': 'rgba(255,92,92,0.12)',
        'cds-cyan-dim': 'rgba(55,230,255,0.12)',
      },
      // Single system-wide font (Inter) — orbitron/mono keys are kept so
      // existing font-orbitron/font-mono classNames don't need touching,
      // they just no longer resolve to a separate typeface.
      fontFamily: {
        orbitron: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'd': '12px',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-in-right': 'slide-in-right 0.2s ease-out',
        'pulse-dot': 'pulse-dot 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
