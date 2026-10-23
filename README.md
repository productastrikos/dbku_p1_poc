# DBKU Command Centre · Dewan Bandaraya Kuching Utara

AI early-warning prototype for vandalism and electrical theft for **Dewan Bandaraya Kuching Utara (DBKU)**, Sarawak. It moves DBKU from *incident → complaint → inspection → repair → repeat* to **prevention, early detection and disruption of the resale channel**: protect assets, trace scrap sales, and coordinate with PDRM, Sarawak Energy and the Ministry of Utility & Telecommunication.

> Prototype on mock data. Road geometry is real (OpenStreetMap); the electrical network, dealers, sellers, incidents and costs are fictional.

**Stack:** React 18 (Create React App) + Tailwind, React-Leaflet (OpenStreetMap and Esri World Imagery tiles, no API key), TensorFlow.js COCO-SSD, Chart.js, jsPDF, Claude API (server-side) via `@anthropic-ai/sdk`.

## Quick start

```bash
npm install
cp .env.example .env.local      # optional: add ANTHROPIC_API_KEY for the LLM features
npm start                       # http://localhost:3000
npm test                        # AI acceptance tests (Jest)
```

Without an API key everything still works: the photo check is skipped and police reports use an offline template. The UI says which mode is active. The key is only read by the server routes in `server/llm.js` (mounted into the dev server by `src/setupProxy.js`); it is never bundled into the browser.

Production: the static build (`npm run build` → `build/`) and the API (`server/index.js`, the LLM routes) run as two processes on their own subdomains, `dbku.astrikos.xyz` and `dbku-api.astrikos.xyz`. The frontend reads the API address from `REACT_APP_API_URL` in `.env.production`. See [DEPLOY.md](DEPLOY.md) for ports, pm2, nginx and Cloudflare. Requires Node 20.12 or later.

## Screens

| Screen | BM | What it does |
|---|---|---|
| Command Dashboard | Pusat Kawalan | KPIs (alerts today, assets at risk, RM loss avoided, suspicious scrap sales), each with a drill-down to the records behind it; Leaflet map with colour-coded assets; live alert feed with the response workflow; open operations |
| Digital Twin | Kembar Digital | Map with Map / Satellite / Hybrid basemaps and layers for asset types, the power network (feeders and lighting circuits, grey and dashed where supply is cut), lamp light pools at night, CCTV fields of view, dealers, patrol route and risk heat; asset IDs from zoom 17. Network overview of every lighting circuit and where supply stops, with the repair order. Each asset's twin: a live schematic drawn from its latest reading (lamp lit, pole tilt, door, supply), its supply chain back to the switchboard and what it feeds, equipment spec, copper and scrap value, sensor node, 6 h / 24 h telemetry, CCTV, alert and incident history and work in progress |
| Operations | Operasi | Patrols, PDRM notifications and work orders raised from alerts, AI insights, the twin or the patrol route, with status history; the command log of every decision |
| CCTV Analyzer | Analisis CCTV | Upload an image or video, or pick one of five bundled sample clips of real surveillance footage; COCO-SSD detections drawn in the browser; drawable asset zone; threat score; HIGH alerts saved with snapshot, timestamp, asset ID and boxes |
| Asset Sensors | Sensor Aset | Sensor stream on the real clock (Live) or fast-forwarded (Simulation); inject a cut cable, opened panel, struck pole or illegal tapping; live z-score charts |
| Risk Forecast | Ramalan Risiko | 7-day risk per hotspot with top-3 reasons, risk heat map, hourly heat grid, night patrol route (dispatchable as a patrol task), model weights |
| Scrap Registry | Daftar Besi Buruk | Dealer submission form (IC hashed in the browser), LLM photo check, PDRM review queue, all sales |
| Reports | Laporan | Case file for any alert or incident; **Generate Police Report** → structured brief → PDF download (not offered for false alarms) |

The header's **AI Insights** panel turns the forecast, live alerts and the review queue into recommended actions; each action creates a tracked task in Operations. The header search finds pages, assets, alerts, incidents, sales, dealers, cameras and tasks, and notifications open the record they are about.

**How records connect.** Dispatching a patrol on an alert creates a patrol task; closing the alert (intercepted, theft confirmed, false alarm, resolved) completes it. Completing a repair work order restores its assets in the twin (lights back on, sensor feed online, circuit re-energised on the map), which also feeds the risk forecast. Marking an alert intercepted adds its asset value to "RM loss avoided".

## The four AI cores

All logic is in `src/ai/` as plain functions, tested in `src/ai/__tests__/ai.test.js`.

1. **AI CCTV threat detection** (`detector.js`, `threatScore.js`). COCO-SSD (mobilenet_v2) detects person, car, motorcycle and truck. Frames darker than mean luminance 70/255 get a second pass on a contrast-stretched copy, with results merged by non-maximum suppression. Score = near asset zone **+30**, night 22:00–06:00 MYT **+30**, dwell over 3 min **+25**, vehicle parked beside asset **+15**; **≥ 70 is HIGH** and raises an alert automatically. For video, dwell and "parked" (vehicle moving < 4% of the frame per second for ≥ 20 s) are measured across sampled frames.
2. **Asset tamper anomaly detection** (`sensorSim.js`, `anomaly.js`). One reading per asset every 5 minutes, plus an immediate report when a sensor changes state: current (A), door contact, tilt (°). A streetlight already logged as dark draws standby current, so it does not re-alert every evening. Each reading is compared with the asset's daily load profile, and the residual is scored with a **rolling z-score** over the last 12 readings in the same operating state. Alert when |z| > 3, door open at night, or tilt > 10°. Causes: **cable cut** (current ≈ 0), **panel opened**, **pole struck**, otherwise *abnormal current draw* (e.g. illegal tapping). Sensor noise is bounded, and the tests run 3 simulated days on every asset with zero false alarms.
3. **Hotspot risk prediction** (`riskModel.js`). Logistic regression trained in the browser on the incident history. Features: zone, day of week (Friday/Saturday night), hour, lighting status (share of streetlights dark), incidents in the last 30 days, distance to the nearest licensed scrap dealer. Training is case-control (22 incident hours vs ~15,000 sampled normal hours, class-balanced), so outputs are relative risk scores. 7-day risk = mean of each night's peak hourly score; bands Low < 0.3, Medium 0.3–0.6, High > 0.6. The top-3 reasons are the largest positive contributions at the zone's peak hour, measured against an average night. Dark lights and new HIGH alerts update the forecast live. The patrol route visits zones by risk and prioritises dark lights, switchboards and assets without CCTV.
4. **Scrap dealer transaction screening** (`scrapScreening.js`, `linking.js`). Flags copper cable > 50 kg; the same seller > 3 times in 7 days *across all dealers* (matched by hashed IC); weight > 3σ above the dealer's average (leave-one-out); and photo classified as "cable/electrical part" (Claude vision). Flagged sales go to the PDRM review queue, and police reports link flagged sales made within 14 days and 15 km of an event.

**Police reports** (`services/caseFile.js`, `server/llm.js`, `services/pdf.js`). The case file holds only computed facts (event, location, evidence, linked sales, RM loss). Claude drafts the brief as schema-validated JSON (`client.beta.messages.parse`, with server-side refusal fallback enabled), told to use only those facts. jsPDF renders it with the evidence snapshot embedded.

All times are Malaysia Time (UTC+8), whatever the browser's time zone.

## Demo script

1. **CCTV Analyzer**: under *Sample CCTV footage*, pick **Car loaded beside a wall panel at dusk**. The 3:20 clip is sampled every 2 s; the car stays parked beside the panel (3.3 min dwell, stationary) while people work at it, so the score is 30 + 25 + 15 = **70, HIGH**, and an alert is raised on DB-SEM-01, labelled as sample footage. The still from the same scene scores 45 (MEDIUM) until you enter a 4-minute dwell from the camera log. The pole samples show what does *not* alert: a daytime passer-by (30) and a quiet night (30). With your own footage, set *Capture time* from the camera log and drag on the image to mark the asset zone; if the capture time is left at "now", night is inferred from low light and the police report asks the officer to confirm the time. The HIGH alert appears as a pulsing marker on the Command Dashboard map.
2. **Asset Sensors**: pick an asset → **Cut cable**. The sensor reports 0 A at once and a **Cable cut** alert is raised. *Jump to 23:00* (switches to Simulation) then **Open panel door** gives **Panel opened**, marked as simulated. **Return to live** re-syncs the sensor clock.
3. **Command Dashboard**: open the new alert → **Dispatch patrol** (a patrol task appears in Operations) → **Intercepted, no loss** (the patrol completes and "RM loss avoided" rises by the asset's value).
4. **Digital Twin**: the network overview shows SEM-C1 without supply, cut at CB-SEM-01; click SL-SEM-02 to follow its supply chain to the break. Then click SL-SEM-09 (dark, lamp failure) → open its work order WO-P003 → **Mark done**. The light comes back on, the asset turns normal and the forecast updates.
5. **Risk Forecast**: the three hotspots are ranked with reasons; Bulatan Semariang is first (dark streetlights, two recent incidents, Friday-night peak). **Dispatch** turns tonight's route into a patrol task.
6. **Scrap Registry**: the review queue holds the 8 planted suspicious sales. *Example: suspicious* → Submit flags a 68 kg copper-cable sale.
7. **Reports**: choose *Cable cut · CB-SEM-01* (11 days ago) → **Generate Police Report** → **Download PDF**. The brief links sale TX-0188 (68.5 kg copper cable, next day, 0.8 km away).

*Reset demo* on the dashboard clears what you created in this browser.

## Mock data

`npm run seed` regenerates `src/data/mock/*.json` (deterministic) from `scripts/generate-mock-data.js`:

- 3 hotspots with 60 assets (13 streetlights, 4 distribution boxes, 2 cable runs and 1 main switchboard each), placed on real road geometry from `scripts/osm-roads.json`, plus 6 existing solar CCTV units
- 22 incidents 2020–2026 totalling RM 2.12M, and streetlight outage history
- 10 fictional scrap dealers in real Kuching localities, and 200 transactions with 8 planted suspicious sales (marked `_plantedReason` for tests only; screening never reads it)
- An electrical network per zone: the main switchboard feeds pillars over feeders (`feeder`), and pillars feed lighting circuits (`circuit`) under 360 m long. Each asset records its supply (`upstream`), equipment spec (`spec`: pole height and lamp, pillar rating and ways, cable cores and size) and sensor node (`node`). Copper mass is length × 4 cores × cross-section × 8.96 g/cm³. The dark lights and the cut cable match the recorded incidents, and the generator fails if the network is disconnected or has a loop.
- Each CCTV unit is mounted on an asset (`mountedOn`) with one or two 90° heads reaching 150 m. An asset counts as covered only when it is inside a head's field of view: 31 of the 60 assets are.
- 9 pilot-period alerts; each records what the operator log saw (`evidence.observed`), and the app derives the threat factors, score and sensor reading from it with the live rules. CCTV pilot alerts only sit on assets a camera covers.
- 8 operations under way: work orders for every dark streetlight and offline sensor, the JKR pole replacement, PDRM notifications and tonight's site check
- Dark streetlights and offline sensors carry their cause and start time (`lightingCause`, `sensorCause`)

Recent records are generated relative to `--asof` (default 2026-10-15). When the app loads, `src/data/rebase.js` moves everything on or after `meta.liveSince` forward by whole days so the as-of day becomes today (never into the future), so "alerts today", "last 30 days" and the 7-day forecast stay current. Dated history (2020–2025) keeps its real dates. `npm run seed -- --asof=YYYY-MM-DD` still regenerates the files for another date.

## Sample CCTV footage

`public/footage/` holds five clips and stills of real fixed-camera surveillance video from the **MEVA dataset** ("Multiview Extended Video with Activities" by Kitware Inc. and IARPA, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [mevadata.org](https://mevadata.org/)). It was recorded with consenting actors at the Muscatatuck Urban Training Center, Indiana, USA, in March 2018, so it shows no DBKU assets and no real incidents. The clips were trimmed, cropped or scaled and re-encoded; `public/footage/ATTRIBUTION.md` lists the exact source file and cut for each.

| Sample | Light | Asset zone | Result with the live rules |
|---|---|---|---|
| Car loaded beside a wall panel (video 3:20) | Dusk, 18:30 | DB-SEM-01 | HIGH 70: near + dwell 3.3 min + parked |
| Same service bay, one frame | Dusk, 18:31 | DB-SEM-01 | MEDIUM 45; HIGH 70 with 4 min dwell from the log |
| Pedestrian walks past a pole (video 0:44) | Day, 11:01 | SL-SEM-06 | LOW 30, no alert |
| The same pole at night, nobody there | Night, 23:57 | SL-SEM-06 | LOW 30, no alert |
| Vehicle passes a roadside post (video 1:00) | Night, 23:59 | SL-KUL-02 | LOW 30, no alert |

`src/data/footage.js` pairs each clip with its asset zone and replays it at the time of day it was recorded (today or yesterday in MYT, never in the future), so the night rule applies as it would to a live camera. Because that time is known, low light alone is not counted as night. The service-bay clips use a 25% minimum confidence: from above in fading light the car scores 25–35% and drops out of some frames at the default 35%. Alerts, snapshots and case files raised from sample footage say so and are never attributed to a DBKU camera; the police brief marks them as demonstration only.

## Project structure

```
server/            llm.js (Claude routes), index.js (production API server)
public/            DBKU logo: dbku-logo.png (as supplied, crest + wordmark; apple-touch icon), and crops of it without the wordmark:
                   dbku-crest.png (sidebar, sign-out screen, PDF letterhead), dbku-mark.png (square: favicon, collapsed sidebar)
public/footage/    sample CCTV clips (MEVA, CC BY 4.0) and their attribution
scripts/           mock-data generator + OSM road geometry
src/
  ai/              detector, threatScore, sensorSim, anomaly, riskModel, scrapScreening, linking, time, geo
  data/            DataProvider (app store), SensorProvider (sensor network), rebase (keeps mock dates current), network (supply chain and lighting circuits), footage (sample clip manifest), reference labels, mock/*.json
  services/        llm client, case file + offline brief, PDF, browser storage
  components/      ui/ and charts/ (design system), layout/ (shell), guard/ (map, asset twin, alert/task drawers, alert feed…)
  pages/           Dashboard, DigitalTwin, Operations, CctvAnalyzer, Sensors, RiskForecast, ScrapRegistry, Reports
  theme/           theme.css (Astrikos UI theme: tokens for dark + light and every component class; spec in ASTRIKOS-UI-THEME 1.md), tones.js, ThemeProvider.js
```

## Limits of the prototype

- A single still frame cannot show dwell time; it comes from the camera log field or from video.
- COCO-SSD has no "lamp post" class, so the operator marks the asset zone (or a camera preset would supply it).
- COCO-SSD (mobilenet) misses small or overhead objects: on the wide shot of the service bay it found nothing, so that sample is cropped to the bay, as a camera preset framed on the asset would be.
- The sample footage is from a US training site, not Kuching; none of it is DBKU evidence.
- The electrical network, equipment specs and camera aims are illustrative, not DBKU or Sarawak Energy records. Satellite imagery (Esri World Imagery, zoom 19 at most) is not current.
- Risk scores are relative (case-control training on 22 incidents), not calibrated probabilities.
- Sensor readings are simulated. In Live mode they follow the real clock; Simulation mode runs faster or jumps ahead and labels its alerts as simulated.
- Operator data is kept in browser storage only; there is no shared backend or authentication.
