/* ═══════════════════════════════════════════════════════════════════════
   APP CONFIG: name, logo and signed-in user.
   Pages and navigation are set in routes.js; colours in theme/theme.css.
   ═══════════════════════════════════════════════════════════════════════ */

// DBKU logo (public/dbku-logo.png, the crest and wordmark on teal). The app
// uses crops of it without the wordmark, since the name is set as text beside
// it: dbku-crest.png (crest) and dbku-mark.png (crest on a square tile).
const PUBLIC = process.env.PUBLIC_URL || '';

export const APP = {
  name: 'DBKU',
  fullName: 'Dewan Bandaraya Kuching Utara',
  subtitle: 'DBKU Command Centre',   // small line under the name in the header
  logo: `${PUBLIC}/dbku-crest.png`,  // in /public; null shows the initials mark
  logoCompact: `${PUBLIC}/dbku-mark.png`, // square mark for the collapsed sidebar (also the favicon)
  logoInitials: 'DB',
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
