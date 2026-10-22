/* ═══════════════════════════════════════════════════════════════════════
   ROUTES: every page in the app, grouped into sidebar sections.

   To add a page:
     1. Create src/pages/MyPage.js
     2. Import it below and add { path, label, icon, element } to a section
   The sidebar, header title, header search and router all read from here.

   icon      a name from src/components/ui/Icon.js
   labelMs   Bahasa Malaysia label shown under the English one (optional)
   keywords  extra words for the header search (optional)
   ═══════════════════════════════════════════════════════════════════════ */
import Dashboard from './pages/Dashboard';
import DigitalTwin from './pages/DigitalTwin';
import Operations from './pages/Operations';
import CctvAnalyzer from './pages/CctvAnalyzer';
import Sensors from './pages/Sensors';
import RiskForecast from './pages/RiskForecast';
import ScrapRegistry from './pages/ScrapRegistry';
import Reports from './pages/Reports';

export const NAV_SECTIONS = [
  {
    label: 'Command',
    items: [
      { path: '/', label: 'Command Dashboard', labelMs: 'Pusat Kawalan', icon: 'home', element: <Dashboard />, keywords: 'home overview kpi map alerts feed pusat kawalan' },
      { path: '/twin', label: 'Digital Twin', labelMs: 'Kembar Digital', icon: 'layers', element: <DigitalTwin />, keywords: 'digital twin asset map layers telemetry streetlight switchboard cable cctv coverage kembar' },
      { path: '/operations', label: 'Operations', labelMs: 'Operasi', icon: 'clipboard', element: <Operations />, keywords: 'tasks patrol work order pdrm notification dispatch command log operasi' },
    ],
  },
  {
    label: 'Protect · Lindungi',
    items: [
      { path: '/cctv',    label: 'CCTV Analyzer', labelMs: 'Analisis CCTV',   icon: 'camera', element: <CctvAnalyzer />, keywords: 'camera video upload detection threat score coco ssd' },
      { path: '/sensors', label: 'Asset Sensors', labelMs: 'Sensor Aset',     icon: 'signal', element: <Sensors />,      keywords: 'tamper anomaly current door tilt cable cut z-score' },
      { path: '/risk',    label: 'Risk Forecast', labelMs: 'Ramalan Risiko',  icon: 'map',    element: <RiskForecast />, keywords: 'hotspot heatmap patrol route logistic regression' },
    ],
  },
  {
    label: 'Trace & Coordinate',
    items: [
      { path: '/scrap',   label: 'Scrap Registry', labelMs: 'Daftar Besi Buruk', icon: 'recycle',  element: <ScrapRegistry />, keywords: 'dealer transactions copper second-hand dealers act pdrm review' },
      { path: '/reports', label: 'Reports',        labelMs: 'Laporan',           icon: 'fileText', element: <Reports />,       keywords: 'police report pdf pdrm brief evidence' },
    ],
  },
];

export const ROUTES = NAV_SECTIONS.flatMap((s) => s.items);
