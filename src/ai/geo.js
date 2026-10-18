/* Geometry helpers (WGS84, metres). */

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres between [lat, lng] pairs. */
export function haversine([lat1, lng1], [lat2, lng2]) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const distanceKm = (a, b) => haversine(a, b) / 1000;

/** Orders points by nearest-neighbour from `start`. Each point needs lat/lng. */
export function nearestNeighbourOrder(start, points) {
  const left = [...points];
  const out = [];
  let cur = start;
  while (left.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = haversine([cur.lat, cur.lng], [left[i].lat, left[i].lng]);
      if (d < bestD) { bestD = d; best = i; }
    }
    const [next] = left.splice(best, 1);
    out.push(next);
    cur = next;
  }
  return out;
}
