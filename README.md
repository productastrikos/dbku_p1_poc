# GuardGrid · DBKU

AI early-warning prototype for vandalism and electrical theft for **Dewan Bandaraya Kuching Utara (DBKU)**, Sarawak. It moves DBKU from *incident → complaint → inspection → repair → repeat* to **prevention, early detection and disruption of the resale channel**: protect assets, trace scrap sales, and coordinate with PDRM, Sarawak Energy and the Ministry of Utility & Telecommunication.

> Prototype on mock data. Road geometry is real (OpenStreetMap); dealers, sellers, incidents and costs are fictional.

**Stack:** React 18 (Create React App) + Tailwind, React-Leaflet / OpenStreetMap, TensorFlow.js COCO-SSD, Chart.js, jsPDF, Claude API (server-side) via `@anthropic-ai/sdk`.

## Quick start

```bash
npm install
cp .env.example .env.local      # optional: add ANTHROPIC_API_KEY for the LLM features
npm start                       # http://localhost:3000
npm test                        # AI acceptance tests (Jest)
```

Without an API key everything still works: the photo check is skipped and police reports use an offline template. The UI says which mode is active. The key is only read by the server routes in `server/llm.js` (mounted into the dev server by `src/setupProxy.js`); it is never bundled into the browser.

Production: `npm run build && npm run serve` (Express on port 8080, serves `build/` and the LLM routes).

## Screens

| Screen | BM | What it does |
|---|---|---|
| Command Dashboard | Pusat Kawalan | KPIs (alerts today, assets at risk, RM loss avoided, suspicious scrap sales), Leaflet map with colour-coded assets, live alert feed with the response workflow |
| CCTV Analyzer | Analisis CCTV | Upload an image or video; COCO-SSD detections drawn in the browser; drawable asset zone; threat score; HIGH alerts saved with snapshot, timestamp, asset ID and boxes |
| Asset Sensors | Sensor Aset | Simulated sensor stream; inject a cut cable, opened panel, struck pole or illegal tapping; live z-score charts |
| Risk Forecast | Ramalan Risiko | 7-day risk per hotspot with top-3 reasons, risk heat map, hourly heat grid, night patrol route, model weights |
| Scrap Registry | Daftar Besi Buruk | Dealer submission form (IC hashed in the browser), LLM photo check, PDRM review queue, all sales |
| Reports | Laporan | Case file for any alert or incident; **Generate Police Report** → structured brief → PDF download |

The header's **AI Insights** panel turns the forecast, live alerts and the review queue into recommended actions (dispatch patrol, notify PDRM, create work order).

## The four AI cores

All logic is in `src/ai/` as plain functions, tested in `src/ai/__tests__/ai.test.js`.

1. **AI CCTV threat detection** (`detector.js`, `threatScore.js`). COCO-SSD (mobilenet_v2) detects person, car, motorcycle and truck. Frames darker than mean luminance 70/255 get a second pass on a contrast-stretched copy, with results merged by non-maximum suppression. Score = near asset zone **+30**, night 22:00–06:00 MYT **+30**, dwell over 3 min **+25**, vehicle parked beside asset **+15**; **≥ 70 is HIGH** and raises an alert automatically. For video, dwell and "parked" (vehicle moving < 4% of the frame per second for ≥ 20 s) are measured across sampled frames.
2. **Asset tamper anomaly detection** (`sensorSim.js`, `anomaly.js`). One reading per asset every 5 simulated minutes: current (A), door contact, tilt (°). Each reading is compared with the asset's daily load profile, and the residual is scored with a **rolling z-score** over the last 12 readings in the same operating state. Alert when |z| > 3, door open at night, or tilt > 10°. Causes: **cable cut** (current ≈ 0), **panel opened**, **pole struck**, otherwise *abnormal current draw* (e.g. illegal tapping). Sensor noise is bounded, and the tests run 3 simulated days on every asset with zero false alarms.
3. **Hotspot risk prediction** (`riskModel.js`). Logistic regression trained in the browser on the incident history. Features: zone, day of week (Friday/Saturday night), hour, lighting status (share of streetlights dark), incidents in the last 30 days, distance to the nearest licensed scrap dealer. Training is case-control (22 incident hours vs ~15,000 sampled normal hours, class-balanced), so outputs are relative risk scores. 7-day risk = mean of each night's peak hourly score; bands Low < 0.3, Medium 0.3–0.6, High > 0.6. The top-3 reasons are the largest positive contributions at the zone's peak hour, measured against an average night. Dark lights and new HIGH alerts update the forecast live. The patrol route visits zones by risk and prioritises dark lights, switchboards and assets without CCTV.
4. **Scrap dealer transaction screening** (`scrapScreening.js`, `linking.js`). Flags copper cable > 50 kg; the same seller > 3 times in 7 days *across all dealers* (matched by hashed IC); weight > 3σ above the dealer's average (leave-one-out); and photo classified as "cable/electrical part" (Claude vision). Flagged sales go to the PDRM review queue, and police reports link flagged sales made within 14 days and 15 km of an event.

**Police reports** (`services/caseFile.js`, `server/llm.js`, `services/pdf.js`). The case file holds only computed facts (event, location, evidence, linked sales, RM loss). Claude drafts the brief as schema-validated JSON (`client.beta.messages.parse`, with server-side refusal fallback enabled), told to use only those facts. jsPDF renders it with the evidence snapshot embedded.

All times are Malaysia Time (UTC+8), whatever the browser's time zone.

## Demo script

1. **CCTV Analyzer**: set *Capture time* from the camera log (e.g. 23:40), then upload a night photo of a person beside a lamp post. Drag on the image to mark the pole as the asset zone. A person near the pole at night scores 60 (MEDIUM). It becomes **HIGH** when a vehicle is beside the asset (+15) or the camera log shows a dwell of more than 3 minutes (+25; enter it in *Dwell from camera log*, or upload video to measure it). The HIGH alert appears as a pulsing marker on the Command Dashboard map. If the capture time is left at "now", night is inferred from the image's low light and the police report asks the officer to confirm the time.
2. **Asset Sensors**: pick an asset → **Cut cable**. The next reading is 0 A and a **Cable cut** alert is raised. *Jump to 23:00* then **Open panel door** gives **Panel opened**.
3. **Risk Forecast**: the three hotspots are ranked with reasons; Bulatan Semariang is first (dark streetlights, two recent incidents, Friday-night peak).
4. **Scrap Registry**: the review queue holds the 8 planted suspicious sales. *Example: suspicious* → Submit flags a 68 kg copper-cable sale.
5. **Reports**: choose *Cable cut · CB-SEM-01* (4 Oct) → **Generate Police Report** → **Download PDF**. The brief links sale TX-0188 (68.5 kg copper cable, next day, 0.8 km away).

*Reset demo* on the dashboard clears what you created in this browser.

## Mock data

`npm run seed` regenerates `src/data/mock/*.json` (deterministic) from `scripts/generate-mock-data.js`:

- 3 hotspots with 60 assets (13 streetlights, 4 distribution boxes, 2 cable runs and 1 main switchboard each), placed on real road geometry from `scripts/osm-roads.json`, plus 6 existing solar CCTV units
- 22 incidents 2020–2026 totalling RM 2.12M, and streetlight outage history
- 10 fictional scrap dealers in real Kuching localities, and 200 transactions with 8 planted suspicious sales (marked `_plantedReason` for tests only; screening never reads it)
- 9 pilot-period alerts

Recent incidents, alerts and sales are placed relative to `--asof` (default 2026-10-15). Re-run with `npm run seed -- --asof=YYYY-MM-DD` to keep "last 30 days" meaningful.

## Project structure

```
server/            llm.js (Claude routes), index.js (production server)
scripts/           mock-data generator + OSM road geometry
src/
  ai/              detector, threatScore, sensorSim, anomaly, riskModel, scrapScreening, linking, time, geo
  data/            DataProvider (app store), SensorProvider (simulation), reference labels, mock/*.json
  services/        llm client, case file + offline brief, PDF, browser storage
  components/      ui/ and charts/ (design system), layout/ (shell), guard/ (map, alert feed, drawer…)
  pages/           Dashboard, CctvAnalyzer, Sensors, RiskForecast, ScrapRegistry, Reports
  theme/           theme.css (template colour tokens, light + dark), components.css
```

## Limits of the prototype

- A single still frame cannot show dwell time; it comes from the camera log field or from video.
- COCO-SSD has no "lamp post" class, so the operator marks the asset zone (or a camera preset would supply it).
- Risk scores are relative (case-control training on 22 incidents), not calibrated probabilities.
- Sensor readings are simulated; the simulation clock runs faster than real time.
- Operator data is kept in browser storage only; there is no shared backend or authentication.
