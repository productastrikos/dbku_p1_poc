/** @type {import('tailwindcss').Config} */
// Bridge to the Astrikos tokens in src/theme/theme.css (spec §5.2).
// Semantic colours (`text-fg-faint`, `bg-surface-raised`, `border-line`…)
// point at the live CSS variables, so they follow the active theme. The stock
// ramps are re-pointed at the brand, so a stray `bg-slate-800` or
// `text-purple-400` still lands on-brand. Change colours in theme.css.
const token = (name) => `var(--app-${name})`;

const graphite = { 50:'#F7F7FA',100:'#E8E6F2',200:'#D6D6D6',300:'#B4B4B4',400:'#8E8E8E',500:'#6E6E6E',600:'#4A4A4A',700:'#333333',800:'#242424',900:'#1A1A1A',950:'#121212' };
const periwinkle = { 50:'#F2F0FF',100:'#E4DFFF',200:'#D9D3FF',300:'#C8BEFF',400:'#BCB0FF',500:'#A597FF',600:'#7B5FE0',700:'#6849CC',800:'#5B3FB8',900:'#463091',950:'#2A1C5C' };
const brandGreen = { 50:'#E8FBF0',100:'#C6F5DA',200:'#94EBBB',300:'#6EE7A4',400:'#34D47C',500:'#0EBC53',600:'#0BA648',700:'#098A3C',800:'#076B2F',900:'#054F23',950:'#032E14' };
const brandRed = { 50:'#FDEEEE',100:'#F9D5D5',200:'#F2B4B4',300:'#EFA8A8',400:'#E86A6A',500:'#D43434',600:'#BE2E2E',700:'#A82828',800:'#8A2020',900:'#6B1919',950:'#3F0F0F' };
const brandAmber = { 50:'#FEF7EA',100:'#FCEBCB',200:'#F8D89B',300:'#F5C87A',400:'#F0B65C',500:'#E8A33D',600:'#C4882F',700:'#A87226',800:'#87591D',900:'#664215',950:'#3D270C' };
const brandOrange = { 50:'#FEF3EB',100:'#FCE2CE',200:'#F8C79F',300:'#F5B681',400:'#F2A365',500:'#EE8B3D',600:'#CC7430',700:'#A85E27',800:'#854A1F',900:'#633717',950:'#3B210E' };
const brandAzure = { 50:'#EFF4FF',100:'#DAE5FF',200:'#BFD2FF',300:'#A6C4FF',400:'#8AAEFF',500:'#6E9BFF',600:'#5C87F0',700:'#4A72D6',800:'#3A5CAD',900:'#2B4483',950:'#1A294F' };
const brandTeal = { 50:'#E9FBF8',100:'#C9F4ED',200:'#A3ECE0',300:'#8FE9DA',400:'#6FD9C8',500:'#4FC9BA',600:'#2F9E91',700:'#25837A',800:'#1D6660',900:'#154B47',950:'#0C2C2A' };

module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Semantic names used across the app, on the live tokens */
        primary:   { DEFAULT: token('accent'),  soft: token('accent-bg') },
        accent:    { DEFAULT: token('accent'),  soft: token('accent-bg') },
        success:   { DEFAULT: token('success'), soft: token('success-bg') },
        warning:   { DEFAULT: token('warning'), soft: token('warning-bg') },
        danger:    { DEFAULT: token('danger'),  soft: token('danger-bg') },
        info:      { DEFAULT: token('info'),    soft: token('info-bg') },
        page:      token('bg'),
        surface:   { DEFAULT: token('surface'), soft: token('surface-soft'), raised: token('surface-raised'), elevated: token('bg-elevated') },
        line:      { DEFAULT: token('border'),  soft: token('border-soft'), strong: token('border-strong') },
        fg:        { DEFAULT: token('text'), muted: token('text-muted'), faint: token('text-faint') },

        /* Brand tokens (§2.1) */
        astrikos: {
          ink:'#353248', carbon:'#2F2E33', steel:'#565559', mist:'#E8E6F2', paper:'#F7F7FA',
          lilac:'#D9D3FF', periwinkle:'#A597FF', iris:'#8B82C3', slate:'#7D7A91',
          go:'#0EBC53', stop:'#D43434',
        },
        /* Live CSS-variable aliases: these follow the active theme */
        app: {
          bg: token('bg'), panel: token('panel'), surface: token('surface'),
          'surface-soft': token('surface-soft'), 'surface-raised': token('surface-raised'),
          elevated: token('bg-elevated'), border: token('border'),
          'border-strong': token('border-strong'), text: token('text'),
          muted: token('text-muted'), faint: token('text-faint'),
          accent: token('accent'), success: token('success'),
          warning: token('warning'), danger: token('danger'), info: token('info'),
        },

        /* Stock ramps, re-pointed at the brand */
        slate: graphite, gray: graphite, zinc: graphite, neutral: { ...graphite, DEFAULT: token('text-faint'), soft: token('surface-raised') }, stone: graphite,
        purple: periwinkle, violet: periwinkle, indigo: periwinkle, fuchsia: periwinkle, pink: periwinkle,
        green: brandGreen, emerald: brandGreen, lime: brandGreen,
        red: brandRed, rose: brandRed,
        amber: brandAmber, yellow: brandAmber, orange: brandOrange,
        blue: brandAzure, sky: brandAzure,
        teal: brandTeal, cyan: brandTeal,
      },
      borderColor: {
        DEFAULT: token('border'),
      },
      fontFamily: {
        display: ['"Lexend Deca"', 'system-ui', 'sans-serif'],
        sans: ['Lato', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        /* `lg` sits on the §3.2 scale (20px) instead of Tailwind's 18px */
        lg: ['1.25rem', { lineHeight: '1.26' }],
        'brand-h1':    ['4rem',     { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '700' }],
        'brand-h2':    ['2rem',     { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '700' }],
        'brand-h3':    ['1.25rem',  { lineHeight: '1.25', letterSpacing: '-0.01em', fontWeight: '700' }],
        'brand-h4':    ['0.75rem',  { lineHeight: '1.35', letterSpacing: '0.02em',  fontWeight: '700' }],
        'brand-body':  ['1rem',     { lineHeight: '1.6' }],
        'brand-body2': ['0.875rem', { lineHeight: '1.55' }],
        'brand-tiny':  ['0.625rem', { lineHeight: '1.4', letterSpacing: '0.04em' }],
      },
      /* One radius family (§4.2): 6 / 8 / 9 / 10 / 12 / 14 / 999 */
      borderRadius: {
        sm: '6px', DEFAULT: '6px', md: '9px', lg: '10px', xl: '12px', '2xl': '14px', '3xl': '14px', full: '999px',
        brand: '10px', panel: '14px',
      },
      boxShadow: {
        sm: 'var(--app-shadow-xs)', DEFAULT: 'var(--app-shadow-sm)', md: 'var(--app-shadow-md)',
        lg: 'var(--app-shadow-lg)', xl: 'var(--app-shadow-lg)',
        'app-xs': 'var(--app-shadow-xs)', 'app-sm': 'var(--app-shadow-sm)',
        'app-md': 'var(--app-shadow-md)', 'app-lg': 'var(--app-shadow-lg)',
        'app-edge': 'var(--app-edge-light)',
      },
      backgroundImage: {
        'astrikos-chrome': 'linear-gradient(135deg,#F7F7FA 0%,#C9C4DC 18%,#8E89A6 38%,#F2F0F7 52%,#9B95B4 68%,#5B5770 86%,#B4AFC8 100%)',
        'astrikos-ink': 'linear-gradient(160deg,#353248 0%,#221E31 55%,#17141F 100%)',
      },
      keyframes: { 'astrikos-sheen': { '0%': { backgroundPosition: '0% 50%' }, '100%': { backgroundPosition: '200% 50%' } } },
    },
  },
  plugins: [],
};
