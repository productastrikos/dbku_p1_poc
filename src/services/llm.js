/* Browser client for the server-side LLM routes in server/llm.js.
   The API key never reaches the browser; these calls go to /api/llm. */

async function post(path, body) {
  const res = await fetch(`/api/llm/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `LLM request failed (${res.status})`);
  return json;
}

export async function getLlmStatus() {
  try {
    const res = await fetch('/api/llm/status');
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch (e) {
    return { enabled: false, reason: 'LLM service not reachable. Run the app with npm start.' };
  }
}

/** 'data:image/jpeg;base64,...' → { mediaType, data } */
export function dataUrlParts(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  return m ? { mediaType: m[1], data: m[2] } : null;
}

/** Vision classification of a scrap photo. */
export function classifyPhoto({ dataUrl, declaredMaterial }) {
  const img = dataUrlParts(dataUrl);
  return post('classify-photo', { image: img.data, mediaType: img.mediaType, declaredMaterial });
}

/** Structured incident brief. images: [{ dataUrl, caption }] */
export function generateBrief({ context, images = [] }) {
  return post('report', {
    context,
    images: images.map((i) => ({ ...dataUrlParts(i.dataUrl), caption: i.caption })),
  });
}
