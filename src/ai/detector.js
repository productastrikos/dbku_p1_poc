/* In-browser object detection with TensorFlow.js COCO-SSD.

   Night CCTV frames are often too dark for the detector, so frames with a
   low mean luminance are also run through a contrast stretch + gamma lift,
   and detections from both passes are merged (non-maximum suppression).
   The model weights download once from the TensorFlow model hub. */
import { TARGET_CLASSES } from './threatScore';

export const LOW_LIGHT_LUMA = 70; // mean luminance (0–255) below which a frame counts as low-light
const MAX_DIM = 1280;

let modelPromise = null;

/** Loads COCO-SSD once (lazy, code-split). Resolves { model, backend }. */
export function loadDetector() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = await import('@tensorflow/tfjs');
      await tf.ready();
      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      const model = await cocoSsd.load({ base: 'mobilenet_v2' });
      return { model, backend: tf.getBackend() };
    })().catch((e) => {
      modelPromise = null;
      throw e;
    });
  }
  return modelPromise;
}

/** Draws an image/video frame into a canvas no larger than MAX_DIM. */
export function toCanvas(source, width, height) {
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Mean luminance 0–255 (sampled). */
export function luminance(canvas) {
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4 * 7) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    n += 1;
  }
  return n ? sum / n : 0;
}

/** Low-light enhancement: 1st–99th percentile stretch, then gamma 0.6. */
export function enhanceLowLight(canvas) {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  const img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])] += 1;
  const total = d.length / 4;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.01) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(Math.min(1, Math.max(0, (v - lo) / span)), 0.6);
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
  ctx.putImageData(img, 0, 0);
  return out;
}

const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

/** Merges detections across passes: same class with IoU > 0.5 keeps the best score. */
export function mergeDetections(lists) {
  const all = lists.flat().sort((a, b) => b.score - a.score);
  const kept = [];
  for (const d of all) if (!kept.some((k) => k.class === d.class && iou(k.box, d.box) > 0.5)) kept.push(d);
  return kept;
}

async function detectOn(model, canvas, minScore, pass) {
  const raw = await model.detect(canvas, 30, minScore);
  return raw
    .filter((r) => TARGET_CLASSES.includes(r.class))
    .map((r) => ({
      class: r.class,
      score: +r.score.toFixed(3),
      pass,
      box: { x: r.bbox[0] / canvas.width, y: r.bbox[1] / canvas.height, w: r.bbox[2] / canvas.width, h: r.bbox[3] / canvas.height },
    }));
}

/** Detects people and vehicles in a frame, with the low-light pass when needed. */
export async function analyseFrame(canvas, { minScore = 0.35 } = {}) {
  const { model } = await loadDetector();
  const luma = luminance(canvas);
  const lowLight = luma < LOW_LIGHT_LUMA;
  const passes = [await detectOn(model, canvas, minScore, 'original')];
  let enhanced = null;
  if (lowLight) {
    enhanced = enhanceLowLight(canvas);
    passes.push(await detectOn(model, enhanced, minScore, 'enhanced'));
  }
  return { detections: mergeDetections(passes), luminance: +luma.toFixed(1), lowLight, enhanced };
}

/* ─── Video ───────────────────────────────────────────────── */
const once = (el, ev) => new Promise((resolve, reject) => {
  const ok = () => { el.removeEventListener('error', bad); resolve(); };
  const bad = () => { el.removeEventListener(ev, ok); reject(new Error('Could not read this video file')); };
  el.addEventListener(ev, ok, { once: true });
  el.addEventListener('error', bad, { once: true });
});

export async function openVideo(url) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  await once(video, 'loadeddata');
  if (!Number.isFinite(video.duration)) await resolveDuration(video);
  return video;
}

// WebM recorded in a browser (MediaRecorder) has no duration in its header and
// reports Infinity. Seeking past the end makes the browser scan the file.
async function resolveDuration(video) {
  await new Promise((resolve, reject) => {
    const done = () => {
      if (!Number.isFinite(video.duration)) return;
      clearTimeout(timer);
      video.removeEventListener('durationchange', done);
      video.removeEventListener('seeked', done);
      resolve();
    };
    const timer = setTimeout(() => reject(new Error('Could not read the length of this video')), 10000);
    video.addEventListener('durationchange', done);
    video.addEventListener('seeked', done);
    video.currentTime = 1e7;
  });
  video.currentTime = 0;
  await once(video, 'seeked');
}

export async function frameAt(video, t) {
  video.currentTime = Math.min(t, Math.max(0, video.duration - 0.05));
  await once(video, 'seeked');
  return toCanvas(video, video.videoWidth, video.videoHeight);
}

/**
 * Samples a video (1 frame/s, at most ~150 frames) and detects objects in each.
 * Returns { frames: [{ t, detections, luminance, lowLight }], duration, step }.
 */
export async function analyseVideo(video, { minScore, onProgress, isCancelled }) {
  const duration = video.duration;
  const step = Math.max(1, Math.ceil(duration / 150));
  const frames = [];
  for (let t = 0; t < duration; t += step) {
    if (isCancelled?.()) break;
    const canvas = await frameAt(video, t);
    const r = await analyseFrame(canvas, { minScore });
    frames.push({ t, detections: r.detections, luminance: r.luminance, lowLight: r.lowLight });
    onProgress?.(Math.min(1, (t + step) / duration));
  }
  return { frames, duration, step };
}
