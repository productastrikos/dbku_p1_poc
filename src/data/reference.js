/* Labels (English + Bahasa Malaysia), statuses and forms shared by pages. */

export const ASSET_TYPES = {
  streetlight:      { label: 'Streetlight',      labelMs: 'Lampu jalan',      icon: 'lightbulb' },
  distribution_box: { label: 'Distribution box', labelMs: 'Kotak agihan',     icon: 'box' },
  switchboard:      { label: 'Main switchboard', labelMs: 'Papan suis utama', icon: 'bolt' },
  cable:            { label: 'Cable run',        labelMs: 'Kabel',            icon: 'route' },
};

// Map colour coding for assets.
export const ASSET_STATUS = {
  alert:   { label: 'Active alert',     labelMs: 'Amaran aktif', tone: 'danger' },
  watch:   { label: 'Watch',            labelMs: 'Pantau',       tone: 'warning' },
  offline: { label: 'Offline / dark',   labelMs: 'Luar talian',  tone: 'neutral' },
  normal:  { label: 'Normal',           labelMs: 'Normal',       tone: 'success' },
};

export const SOURCES = {
  cctv:   { label: 'AI CCTV',      labelMs: 'CCTV AI',            icon: 'camera' },
  sensor: { label: 'Tamper sensor', labelMs: 'Sensor gangguan',   icon: 'signal' },
  scrap:  { label: 'Scrap screening', labelMs: 'Saringan besi buruk', icon: 'recycle' },
};

export const ALERT_STATUS = {
  open:            { label: 'Open',            labelMs: 'Baharu',          tone: 'danger',  active: true },
  acknowledged:    { label: 'Acknowledged',    labelMs: 'Diakui',          tone: 'warning', active: true },
  dispatched:      { label: 'Patrol dispatched', labelMs: 'Rondaan dihantar', tone: 'info', active: true },
  intercepted:     { label: 'Intercepted',     labelMs: 'Dihalang',        tone: 'success', active: false },
  confirmed_theft: { label: 'Theft confirmed', labelMs: 'Kecurian disahkan', tone: 'danger', active: false },
  false_alarm:     { label: 'False alarm',     labelMs: 'Amaran palsu',    tone: 'neutral', active: false },
  resolved:        { label: 'Resolved',        labelMs: 'Selesai',         tone: 'neutral', active: false },
};
export const isActive = (alert) => ALERT_STATUS[alert.status]?.active;

export const REVIEW_STATUS = {
  pending:  { label: 'Pending PDRM review', labelMs: 'Menunggu semakan', tone: 'warning' },
  referred: { label: 'Referred to PDRM',    labelMs: 'Dirujuk ke PDRM',  tone: 'danger' },
  cleared:  { label: 'Cleared',             labelMs: 'Dibersihkan',      tone: 'success' },
};

export const ZONE_TONE = { High: 'danger', Medium: 'warning', Low: 'success' };

// Forms opened by AI-insight action buttons. Field types: select | text | textarea
export const ACTION_FORMS = {
  dispatch: {
    title: 'Dispatch night patrol',
    fields: [
      { key: 'team',     label: 'Team',     type: 'select', options: ['DBKU Enforcement Unit A', 'DBKU Enforcement Unit B', 'Joint DBKU–PDRM patrol'] },
      { key: 'priority', label: 'Priority', type: 'select', options: ['Immediate', 'Tonight', 'Next patrol cycle'] },
      { key: 'notes',    label: 'Notes',    type: 'textarea', placeholder: 'Stops, timing, radio channel…' },
    ],
  },
  notify: {
    title: 'Notify PDRM',
    fields: [
      { key: 'station', label: 'Police station', type: 'select', options: ['IPD Kuching', 'Balai Polis Petra Jaya', 'Balai Polis Satok'] },
      { key: 'channel', label: 'Channel',        type: 'select', options: ['Phone + email', 'Email', 'Liaison officer'] },
      { key: 'message', label: 'Message',        type: 'textarea', placeholder: 'What PDRM should know…' },
    ],
  },
  task: {
    title: 'Create work order',
    fields: [
      { key: 'title',    label: 'Title',    type: 'text', placeholder: 'Short description' },
      { key: 'team',     label: 'Team',     type: 'select', options: ['DBKU Electrical', 'Sarawak Energy', 'Ministry of Utility & Telecommunication'] },
      { key: 'priority', label: 'Priority', type: 'select', options: ['Critical', 'High', 'Normal'] },
      { key: 'details',  label: 'Details',  type: 'textarea', placeholder: 'What needs to be done…' },
    ],
  },
};

export const formatRM = (v) => `RM ${Math.round(v || 0).toLocaleString('en-MY')}`;
export const formatRMShort = (v) => (v >= 1e6 ? `RM ${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `RM ${(v / 1e3).toFixed(0)}k` : formatRM(v));
