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
      },
      // Single system-wide font (Inter) — orbitron/mono keys are kept so
      // existing font-orbitron/font-mono classNames don't need touching,
      // they just no longer resolve to a separate typeface.
      fontFamily: {
        orbitron: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'd': '12px',
      },
    },
  },
  plugins: [],
} satisfies Config;
