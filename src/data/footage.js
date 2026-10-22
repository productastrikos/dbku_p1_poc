/* Sample CCTV footage bundled in public/footage/.

   Every clip comes from the MEVA dataset (Kitware Inc. and IARPA, CC BY 4.0):
   real fixed-camera surveillance video recorded with consenting actors at the
   Muscatatuck Urban Training Center, Indiana, USA, in March 2018. None of it
   shows DBKU assets. Each entry records where the clip came from, how it was
   cut, the asset zone that matches what is in shot, and what GuardGrid's
   rules make of it. The CCTV Analyzer replays a clip at the same time of day
   it was recorded, so the night rule applies as it would to a live camera. */
import { atMytHour, DAY } from '../ai/time';

export const FOOTAGE_SOURCE = {
  name: 'MEVA (Multiview Extended Video with Activities)',
  credit: '"Multiview Extended Video with Activities" (MEVA) dataset by Kitware Inc. and the Intelligence Advanced Research Projects Activity (IARPA)',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  url: 'https://mevadata.org/',
  bucket: 'https://mevadata-public-01.s3.amazonaws.com/',
  site: 'Muscatatuck Urban Training Center, Indiana, USA',
  changes: 'Trimmed, cropped or scaled to 960×540 (one still 1280×720), 15 fps, re-encoded as H.264/JPEG, audio removed.',
};

export const SAMPLE_FOOTAGE = [
  {
    id: 'service-bay-dusk',
    kind: 'video',
    title: 'Car loaded beside a wall panel at dusk',
    scene: 'A car is parked in a service bay right beside a wall-mounted electrical panel. Two people come out of the side door and load it.',
    light: 'Dusk',
    file: 'meva-g301-dusk-service-bay.mp4',
    poster: 'meva-g301-dusk-service-bay-poster.jpg',
    camera: 'G301',
    site: 'hospital building, rear service bay',
    recordedAt: '2018-03-08T18:30:02-05:00',
    tz: 'EST',
    durationSec: 200,
    source: 'drop-4-hadcv22/2018-03-08/18/2018-03-08.18-30-02.18-35-02.hospital.G301.r13.avi',
    cut: 'first 200 s of the 5-minute clip, cropped to the service bay',
    replayAt: '18:30',
    assetId: 'DB-SEM-01',
    zone: { x: 0.4, y: 0.34, w: 0.23, h: 0.26 },
    // Seen from above in fading light the car scores 25–35%; at the default 35% it drops out of some frames.
    minScore: 0.25,
    expect: 'HIGH · 70. The car stays parked beside the panel for the whole clip (3.3 min measured) while people work at it.',
  },
  {
    id: 'service-bay-dusk-still',
    kind: 'image',
    title: 'Same service bay, one frame',
    scene: 'One frame from the clip above: two people at the open car beside the wall panel.',
    light: 'Dusk',
    file: 'meva-g301-dusk-service-bay.jpg',
    poster: 'meva-g301-dusk-still-poster.jpg',
    camera: 'G301',
    site: 'hospital building, rear service bay',
    recordedAt: '2018-03-08T18:31:54-05:00',
    tz: 'EST',
    source: 'drop-4-hadcv22/2018-03-08/18/2018-03-08.18-30-02.18-35-02.hospital.G301.r13.avi',
    cut: 'frame at 112 s, cropped to the service bay',
    replayAt: '18:31',
    assetId: 'DB-SEM-01',
    zone: { x: 0.4, y: 0.34, w: 0.23, h: 0.26 },
    minScore: 0.25,
    expect: 'MEDIUM · 45. A still can\'t show dwell: enter 4 min from the camera log and it becomes HIGH (70).',
  },
  {
    id: 'pole-day-passerby',
    kind: 'video',
    title: 'Pedestrian walks past a pole',
    scene: 'Daytime. A pedestrian follows the footpath past the base of a pole and walks on; a pickup is parked well away from it.',
    light: 'Day',
    file: 'meva-g336-day-passerby.mp4',
    poster: 'meva-g336-day-passerby-poster.jpg',
    camera: 'G336',
    site: 'school building, front circle',
    recordedAt: '2018-03-07T11:01:02-05:00',
    tz: 'EST',
    durationSec: 44,
    source: 'drops-123-r13/2018-03-07/11/2018-03-07.11-00-06.11-05-05.school.G336.r13.avi',
    cut: '56–100 s of the 5-minute clip',
    replayAt: '11:01',
    assetId: 'SL-SEM-06',
    zone: { x: 0.54, y: 0.02, w: 0.03, h: 0.87 },
    expect: 'LOW · 30. Someone passing close by in daylight is noted but raises no alert.',
  },
  {
    id: 'pole-night-quiet',
    kind: 'image',
    title: 'The same pole at night, nobody there',
    scene: 'Same camera just before midnight. Low light; nobody near the pole.',
    light: 'Night',
    file: 'meva-g336-night-pole.jpg',
    poster: 'meva-g336-night-pole-poster.jpg',
    camera: 'G336',
    site: 'school building, front circle',
    recordedAt: '2018-03-11T23:57:01-04:00',
    tz: 'EDT',
    source: 'drops-123-r13/2018-03-11/00/2018-03-11.23-55-01.00-00-01.school.G336.r13.avi',
    cut: 'frame at 120 s',
    replayAt: '23:57',
    assetId: 'SL-SEM-06',
    zone: { x: 0.54, y: 0.02, w: 0.03, h: 0.87 },
    expect: 'LOW · 30. Night on its own is not a threat; the low-light pass runs and finds nobody.',
  },
  {
    id: 'post-night-vehicle',
    kind: 'video',
    title: 'Vehicle passes a roadside post at night',
    scene: 'Night. A vehicle\'s headlights sweep the road and it drives through; nothing stops at the post.',
    light: 'Night',
    file: 'meva-g436-night-vehicle.mp4',
    poster: 'meva-g436-night-vehicle-poster.jpg',
    camera: 'G436',
    site: 'hospital building, access road',
    recordedAt: '2018-03-11T23:59:05-04:00',
    tz: 'EDT',
    durationSec: 60,
    source: 'drops-123-r13/2018-03-11/00/2018-03-11.23-55-09.00-00-09.hospital.G436.r13.avi',
    cut: '236–296 s of the 5-minute clip',
    replayAt: '23:59',
    assetId: 'SL-KUL-02',
    zone: { x: 0.28, y: 0.64, w: 0.05, h: 0.2 },
    expect: 'LOW · 30. Traffic driving past an asset at night is not flagged.',
  },
];

export const footageUrl = (file) => `${process.env.PUBLIC_URL || ''}/footage/${file}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "8 Mar 2018, 18:30 EST": the camera's local time, as MEVA records it. */
export function recordedLabel(sample) {
  const [, y, mo, d, hh, mm] = sample.recordedAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return `${Number(d)} ${MONTHS[mo - 1]} ${y}, ${hh}:${mm} ${sample.tz}`;
}

/** The latest moment (today or yesterday, MYT) at the clip's recorded time of day, never in the future. */
export function replayTime(sample, now = Date.now()) {
  const [h, m] = sample.replayAt.split(':').map(Number);
  const t = atMytHour(now, h, m);
  return t > now ? t - DAY : t;
}

export const durationLabel = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
