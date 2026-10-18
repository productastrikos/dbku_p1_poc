/* ═══════════════════════════════════════════════════════════════════════
   APP CONFIG: name, logo and signed-in user.
   Pages and navigation are set in routes.js; colours in theme/theme.css.
   ═══════════════════════════════════════════════════════════════════════ */

export const APP = {
  name: 'GuardGrid',
  subtitle: 'DBKU Command Centre',   // small line under the name in the header
  logo: '/guardgrid.svg',            // in /public; null shows the initials mark
  logoInitials: 'GG',
  locale: 'en-MY',
  timeZone: 'Asia/Kuching',          // header clock and all times shown in the app

  // Header features. Set to false to hide.
  features: {
    search: true,
    clock: true,
    notifications: true,
    insights: true,                  // AI insights side panel
    themeToggle: true,
  },
};

// Placeholder user. Replace with your auth provider's user object.
export const USER = {
  name: 'Pegawai Bertugas',
  role: 'Duty Officer · DBKU Enforcement',
};
