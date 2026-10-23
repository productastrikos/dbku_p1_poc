import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import { MapContainer, TileLayer, CircleMarker, Circle, Marker, Polygon, Polyline, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { resolveColor } from '../charts/chartTheme';
import { useTheme } from '../../theme/ThemeProvider';
import { ASSET_TYPES, ASSET_STATUS, ZONE_TONE } from '../../data/reference';
import { lampsOnAt } from '../../data/network';
import { formatMyt } from '../../ai/time';
import { toneVar } from '../../theme/tones';
import { Icon } from '../ui';

const stopIcon = (n) => L.divIcon({ className: '', html: `<div class="route-stop">${n}</div>`, iconSize: [20, 20], iconAnchor: [10, 10] });

/* ─── Basemaps (no API keys) ─────────────────────────────── */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const BASEMAPS = {
  map: { label: 'Map', title: 'OpenStreetMap (darkened in the dark theme)' },
  satellite: { label: 'Satellite', title: 'Esri World Imagery' },
  hybrid: { label: 'Hybrid', title: 'Esri World Imagery with road names' },
};
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ESRI_ATTR = 'Imagery &copy; Esri, Maxar, Earthstar Geographics';
const readBasemap = () => { try { return localStorage.getItem('gg_basemap') || 'map'; } catch { return 'map'; } };
const saveBasemap = (v) => { try { localStorage.setItem('gg_basemap', v); } catch { /* storage unavailable */ } };

/* ─── Asset symbols ──────────────────────────────────────── */
/* Constant parts read the theme tokens directly (the markup lives in the page),
   so markers follow the theme; `fill` is the resolved status colour. */
const ON = 'var(--app-on-color)';
const FAINT = 'var(--app-text-faint)';
const SIZE = { streetlight: 16, distribution_box: 16, switchboard: 22, camera: 18 };
function symbol(type, fill, { dark, lit } = {}, size = SIZE[type]) {
  const wh = `width="${size}" height="${size}"`;
  if (type === 'streetlight') {
    return `<svg ${wh} viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.4" fill="${dark ? 'var(--app-bg)' : fill}" stroke="${dark ? fill : ON}" stroke-width="${dark ? 2.6 : 1.8}"/>`
      + `<circle cx="8" cy="8" r="${lit ? 2.6 : 2}" fill="${dark ? 'var(--app-text-faint)' : lit ? 'var(--app-warning-soft)' : ON}"/></svg>`;
  }
  if (type === 'distribution_box') {
    return `<svg ${wh} viewBox="0 0 16 16"><rect x="1.4" y="1.4" width="13.2" height="13.2" rx="2.6" fill="${fill}" stroke="${ON}" stroke-width="1.8"/>`
      + `<path d="M5 5.4h6M5 8h6M5 10.6h6" stroke="${ON}" stroke-width="1.3" stroke-linecap="round"/></svg>`;
  }
  if (type === 'switchboard') {
    return `<svg ${wh} viewBox="0 0 22 22"><rect x="1.4" y="1.4" width="19.2" height="19.2" rx="3.6" fill="${fill}" stroke="${ON}" stroke-width="2"/>`
      + `<path d="M12.3 4.4 6.9 12.2h3.7l-1 5.4 5.5-7.8h-3.8z" fill="${ON}"/></svg>`;
  }
  return `<svg ${wh} viewBox="0 0 18 18"><circle cx="9" cy="9" r="7.8" fill="${fill}" stroke="${ON}" stroke-width="1.8"/>`
    + `<path d="M4.6 6.8h5.6a1 1 0 0 1 1 1v.4l2.3-1.4v4.4l-2.3-1.4v.4a1 1 0 0 1-1 1H4.6a1 1 0 0 1-1-1V7.8a1 1 0 0 1 1-1z" fill="${ON}"/></svg>`;
}
const iconCache = new Map();
function assetIcon(type, fill, opts = {}) {
  const key = `${type}|${fill}|${opts.dark}|${opts.lit}|${opts.alert}|${opts.anchor}`;
  if (!iconCache.has(key)) {
    const s = SIZE[type];
    iconCache.set(key, L.divIcon({
      className: '', html: `<div class="gg-icon${opts.alert ? ' is-alert' : ''}" style="width:${s}px;height:${s}px">${symbol(type, fill, opts)}</div>`,
      iconSize: [s, s], iconAnchor: opts.anchor || [s / 2, s / 2],
    }));
  }
  return iconCache.get(key);
}
const labelIcon = (text) => L.divIcon({ className: '', html: `<span class="gg-label">${text}</span>`, iconSize: [0, 0], iconAnchor: [-11, 8] });

/* ─── Geometry ───────────────────────────────────────────── */
function destination([lat, lng], bearingDeg, metres) {
  const b = (bearingDeg * Math.PI) / 180;
  return [lat + (metres * Math.cos(b)) / 111320, lng + (metres * Math.sin(b)) / (111320 * Math.cos((lat * Math.PI) / 180))];
}
function wedge(origin, { heading, fovDeg, rangeM }) {
  const arc = [];
  for (let d = -fovDeg / 2; d <= fovDeg / 2 + 0.01; d += 5) arc.push(destination(origin, heading + d, rangeM));
  return [origin, ...arc];
}
function boundsFor(zones, assets) {
  const pts = assets.length ? assets.flatMap((a) => a.path || [[a.lat, a.lng]]) : zones.map((z) => z.center);
  return L.latLngBounds(pts).pad(0.12);
}

/* ─── Map helpers (children of MapContainer) ─────────────── */
// Re-fits when `fitKey` changes, zooms to street level on the selected
// asset, and zooms back out when the selection is cleared.
function Viewport({ bounds, fitKey, target, fitSignal }) {
  const map = useMap();
  const first = useRef(true);
  const hadTarget = useRef(false);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    map.fitBounds(bounds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, fitSignal]);
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 18), { duration: 0.6 });
    else if (hadTarget.current) map.fitBounds(bounds);
    hadTarget.current = Boolean(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.[0], target?.[1]]);
  return null;
}

function Scale() {
  const map = useMap();
  useEffect(() => {
    const c = L.control.scale({ imperial: false, position: 'bottomright', maxWidth: 110 }).addTo(map);
    return () => c.remove();
  }, [map]);
  return null;
}

function ZoomWatch({ onZoom }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => { onZoom(map.getZoom()); }, [map, onZoom]);
  return null;
}

// Cursor position and zoom, rendered into the card so moving the mouse never re-renders the layers.
function CursorReadout({ target }) {
  const [pos, setPos] = useState(null);
  const map = useMapEvents({
    mousemove: (e) => setPos({ lat: e.latlng.lat, lng: e.latlng.lng, z: map.getZoom() }),
    mouseout: () => setPos(null),
  });
  if (!target || !pos) return null;
  return createPortal(
    <span className="gg-chip font-mono">{pos.lat.toFixed(5)}, {pos.lng.toFixed(5)} · z{pos.z}</span>,
    target,
  );
}

/**
 * Leaflet map of DBKU assets.
 *   assets       live assets (.status, .lighting, .upstream…)
 *   zones        hotspot zones (boundary polygon); zoneBands tints them by risk band
 *   cameras      CCTV units; `coverage` draws each head's field of view
 *   network      buildNetwork() result; `power` draws feeders and circuits (amber live, grey dashed when cut)
 *   lighting     draws each lamp's lit area (brighter while lamps are on), and dashed gaps where a lamp is dark
 *   clock        time shown on the map (lamps on 19:00–07:00); defaults to now
 *   dealers, route, heat, selectedId, fitKey, focus, onSelectAsset, onSelectCamera as before
 */
export default function AssetMap({
  assets, zones, zoneBands, cameras, dealers, route, height = 480, onSelectAsset, onSelectCamera, heat = false,
  coverage = false, network, power = false, lighting = false, clock, selectedId, fitKey, legend = true, focus,
  className = '', children,
}) {
  const { theme } = useTheme();
  const [basemap, setBasemap] = useState(readBasemap);
  const [zoom, setZoom] = useState(15);
  const [fitSignal, setFitSignal] = useState(0);
  const [readout, setReadout] = useState(null);
  const bounds = useMemo(() => boundsFor(zones, focus ? assets.filter((a) => a.zone === focus) : assets), [zones, assets, focus]);
  const tone = (status) => resolveColor(ASSET_STATUS[status]?.tone || 'success');
  const zoneColor = (z) => resolveColor(zoneBands?.[z.id] ? ZONE_TONE[zoneBands[z.id]] : 'primary');
  const selected = assets.find((a) => a.id === selectedId) || cameras?.find((c) => c.id === selectedId);
  const byId = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a])), [assets]);
  const now = clock ?? Date.now();
  const lampsOn = lampsOnAt(now);
  const live = (a) => !network || network.energised(a.id);
  const lightOn = (a) => a.type === 'streetlight' && a.lighting !== 'out' && live(a);
  const darkCount = assets.filter((a) => a.lighting === 'out').length;
  const imagery = basemap !== 'map';
  const showLabels = zoom >= 17;
  const pick = (v) => { setBasemap(v); saveBasemap(v); };
  const info = (a) => (
    <>
      <strong>{a.id}</strong> · {ASSET_TYPES[a.type].label} <span style={{ opacity: 0.7 }}>({ASSET_TYPES[a.type].labelMs})</span><br />
      {a.name}, {a.road}<br />
      Status: <strong style={{ color: tone(a.status) }}>{ASSET_STATUS[a.status].label}</strong>
      {a.type === 'streetlight' && <> · {a.lighting === 'out' ? 'lamp dark' : lampsOn ? 'lamp on' : 'lamp off (daytime)'}</>}
      {network && a.upstream && <><br />Fed from {a.upstream}{a.circuit ? ` · circuit ${a.circuit}` : a.feeder ? ` · feeder ${a.feeder}` : ''}{live(a) ? '' : ' · no supply'}</>}
      {a.openAlerts?.map((x) => <div key={x.id} className="flex items-center gap-1" style={{ color: resolveColor('danger') }}><Icon name="alert" size={11} />{x.title}</div>)}
    </>
  );
  const hover = (a) => (onSelectAsset ? <Tooltip direction="top" offset={[0, -8]}>{info(a)}</Tooltip> : <Popup>{info(a)}</Popup>);
  const links = power && network ? network.links.filter((l) => byId[l.parentId] && byId[l.childId]) : [];

  return (
    // `isolation` keeps Leaflet's pane z-indexes inside the card, so side panels and drawers always cover the map.
    <div className={`card overflow-hidden relative ${className}`} style={{ height, isolation: 'isolate' }}>
      <MapContainer key={`${focus || 'all'}`} bounds={bounds} maxZoom={20} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        {basemap === 'map' ? (
          <TileLayer key={`osm-${theme}`} url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution={OSM_ATTR}
            maxZoom={20} maxNativeZoom={19} className={theme === 'dark' ? 'gg-tiles-dark' : ''} />
        ) : (
          <TileLayer key="esri" url={`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`} attribution={ESRI_ATTR} maxZoom={20} maxNativeZoom={19} />
        )}
        {basemap === 'hybrid' && (
          <TileLayer key="esri-roads" url={`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`} maxZoom={20} maxNativeZoom={19} opacity={0.85} />
        )}
        <Viewport bounds={bounds} fitKey={fitKey} fitSignal={fitSignal} target={selected ? [selected.lat, selected.lng] : null} />
        <Scale />
        <ZoomWatch onZoom={setZoom} />
        <CursorReadout target={readout} />

        {zones.map((z) => (heat ? (
          [2.2, 1.6, 1.1].map((k, i) => (
            <Circle key={`h-${z.id}-${i}-${theme}-${zoneBands?.[z.id]}`} center={z.center} radius={z.radiusM * k * 0.75}
              pathOptions={{ stroke: false, fillColor: zoneColor(z), fillOpacity: 0.12 + i * 0.06 }} />
          ))
        ) : z.boundary ? (
          <Polygon key={`z-${z.id}-${theme}-${zoneBands?.[z.id]}`} positions={z.boundary}
            pathOptions={{ color: zoneColor(z), weight: 1.5, dashArray: '6 6', fillColor: zoneColor(z), fillOpacity: imagery ? 0.03 : 0.05 }}>
            <Tooltip direction="top" sticky>{z.name}{zoneBands?.[z.id] ? ` · ${zoneBands[z.id]} risk` : ''}</Tooltip>
          </Polygon>
        ) : (
          <Circle key={`z-${z.id}-${theme}-${zoneBands?.[z.id]}`} center={z.center} radius={z.radiusM}
            pathOptions={{ color: zoneColor(z), weight: 1.5, dashArray: '6 6', fillColor: zoneColor(z), fillOpacity: 0.06 }}>
            <Tooltip direction="top" sticky>{z.name}{zoneBands?.[z.id] ? ` · ${zoneBands[z.id]} risk` : ''}</Tooltip>
          </Circle>
        )))}

        {/* Lit area of each working lamp; a dashed ring where a lamp should be lighting the road but is dark. */}
        {lighting && assets.filter((a) => a.type === 'streetlight').map((a) => (lightOn(a) ? (
          <Circle key={`lp-${a.id}-${lampsOn}`} center={[a.lat, a.lng]} radius={20} interactive={false}
            pathOptions={{ stroke: false, fillColor: resolveColor('warning-soft'), fillOpacity: lampsOn ? 0.34 : 0.12 }} />
        ) : (
          <Circle key={`lg-${a.id}-${theme}`} center={[a.lat, a.lng]} radius={20} interactive={false}
            pathOptions={{ color: resolveColor('danger'), weight: 1.2, dashArray: '3 4', fillColor: resolveColor('danger'), fillOpacity: lampsOn ? 0.14 : 0.05 }} />
        )))}

        {coverage && cameras?.flatMap((c) => (c.heads || []).map((h, i) => (
          <Polygon key={`fov-${c.id}-${i}-${theme}`} positions={wedge([c.lat, c.lng], h)} interactive={false}
            pathOptions={{ color: resolveColor('info'), weight: 1, opacity: 0.55, fillColor: resolveColor('info'), fillOpacity: imagery ? 0.14 : 0.09 }} />
        )))}

        {links.map((l) => (
          <Polyline key={`n-${l.id}-${l.energised}-${theme}`} positions={l.positions}
            pathOptions={{ color: resolveColor(l.energised ? 'warning' : 'text-faint'), weight: l.kind === 'feeder' ? 3 : 1.6, opacity: 0.9, dashArray: l.energised ? undefined : '5 5' }}>
            <Tooltip sticky>{l.kind === 'feeder' ? `Feeder ${byId[l.childId].feeder}` : `Circuit ${byId[l.childId].circuit}`} · {l.parentId} → {l.childId}{l.energised ? '' : ' · no supply'}</Tooltip>
          </Polyline>
        ))}

        {assets.filter((a) => a.type === 'cable').map((a) => (
          <Polyline key={`p-${a.id}-${a.status}-${theme}-${a.id === selectedId}`} positions={a.path}
            pathOptions={{ color: tone(a.status), weight: a.id === selectedId ? 8 : 5, opacity: a.id === selectedId ? 1 : 0.85, dashArray: a.status === 'offline' ? '4 6' : undefined, lineCap: 'round' }}
            eventHandlers={{ click: () => onSelectAsset?.(a) }}>
            {hover(a)}
          </Polyline>
        ))}

        {route?.stops?.length > 0 && (
          <>
            <Polyline key={`route-${theme}`} positions={[[route.base.lat, route.base.lng], ...route.stops.map((s) => [s.asset.lat, s.asset.lng])]}
              pathOptions={{ color: resolveColor('primary'), weight: 3, opacity: 0.85, dashArray: '8 6' }} />
            <CircleMarker center={[route.base.lat, route.base.lng]} radius={7} pathOptions={{ color: resolveColor('on-color'), weight: 2, fillColor: resolveColor('primary'), fillOpacity: 1 }}>
              <Tooltip direction="top">{route.base.name} · patrol base</Tooltip>
            </CircleMarker>
            {route.stops.map((s, i) => (
              <Marker key={`stop-${s.asset.id}`} position={[s.asset.lat, s.asset.lng]} icon={stopIcon(i + 1)} zIndexOffset={800}
                eventHandlers={{ click: () => onSelectAsset?.(s.asset) }}>
                <Tooltip direction="top">{i + 1}. {s.asset.id} · ETA {s.eta}</Tooltip>
              </Marker>
            ))}
          </>
        )}

        {dealers?.map((d) => (
          <CircleMarker key={`d-${d.id}-${theme}`} center={[d.lat, d.lng]} radius={6}
            pathOptions={{ color: resolveColor('on-color'), weight: 1.5, fillColor: resolveColor('teal'), fillOpacity: 0.95 }}>
            <Popup><strong>{d.name}</strong><br />Licence {d.licenceNo}<br />{d.area}<br />Licensed since {d.licensedSince}</Popup>
          </CircleMarker>
        ))}

        {selected && !selected.path && (
          <CircleMarker key={`sel-${selected.id}-${theme}`} center={[selected.lat, selected.lng]} radius={15} interactive={false}
            pathOptions={{ color: resolveColor('primary'), weight: 3, fill: false }} />
        )}

        {assets.filter((a) => a.type !== 'cable').map((a) => (
          <Marker key={`a-${a.id}`} position={[a.lat, a.lng]} zIndexOffset={a.status === 'alert' ? 1000 : a.type === 'switchboard' ? 300 : 0}
            icon={assetIcon(a.type, tone(a.status), { dark: a.lighting === 'out', lit: lampsOn && lightOn(a), alert: a.status === 'alert' })}
            eventHandlers={{ click: () => onSelectAsset?.(a) }}>
            {hover(a)}
          </Marker>
        ))}

        {/* Cameras sit on their mount, drawn just up and to the right so both symbols stay clickable. */}
        {cameras?.map((c) => (
          <Marker key={`c-${c.id}-${theme}`} position={[c.lat, c.lng]} zIndexOffset={600}
            icon={assetIcon('camera', resolveColor('info'), { anchor: [-3, 21] })} eventHandlers={{ click: () => onSelectCamera?.(c) }}>
            <Tooltip direction="top" offset={[12, -20]}>
              {c.id} · {c.model}<br />On {c.mountedOn}, {c.mountHeightM ?? 6} m up · {(c.heads || []).map((h) => `${h.heading}°`).join(' and ')} · {c.heads?.[0]?.rangeM ?? '–'} m<br />
              Covers {c.covers.length} assets
            </Tooltip>
          </Marker>
        ))}

        {showLabels && assets.filter((a) => a.type !== 'cable').map((a) => (
          <Marker key={`lb-${a.id}`} position={[a.lat, a.lng]} icon={labelIcon(a.id)} interactive={false} keyboard={false} />
        ))}
        {showLabels && assets.filter((a) => a.type === 'cable').map((a) => (
          <Marker key={`lb-${a.id}`} position={a.path[Math.floor(a.path.length / 2)]} icon={labelIcon(a.id)} interactive={false} keyboard={false} />
        ))}
        {children}
      </MapContainer>

      <div className="gg-map-ctl is-tr">
        <div className="gg-seg" role="group" aria-label="Basemap">
          {Object.entries(BASEMAPS).map(([k, b]) => (
            <button key={k} type="button" title={b.title} className={basemap === k ? 'is-active' : ''} aria-pressed={basemap === k} onClick={() => pick(k)}>{b.label}</button>
          ))}
          <button type="button" title="Zoom to fit" onClick={() => setFitSignal((n) => n + 1)}>Fit</button>
        </div>
        {(lighting || clock != null) && (
          <span className="gg-chip">
            <b>{formatMyt(now, 'time')} MYT</b> · {lampsOn ? 'lamps on' : 'daylight, lamps off until 19:00'}
          </span>
        )}
      </div>
      <div className="gg-map-ctl is-br" ref={setReadout} />

      {legend && (
        <div className="map-legend">
          {Object.entries(ASSET_STATUS).map(([k, s]) => (
            <span key={k} title={s.hint}><span className="legend-dot" style={{ background: toneVar(s.tone) }} />{s.label}</span>
          ))}
          <span><span className="gg-sym" dangerouslySetInnerHTML={{ __html: symbol('streetlight', FAINT, {}, 11) }} />Streetlight</span>
          <span><span className="gg-sym" dangerouslySetInnerHTML={{ __html: symbol('distribution_box', FAINT, {}, 11) }} />Pillar</span>
          <span><span className="gg-sym" dangerouslySetInnerHTML={{ __html: symbol('switchboard', FAINT, {}, 12) }} />Switchboard</span>
          {darkCount > 0 && <span><span className="gg-sym" dangerouslySetInnerHTML={{ __html: symbol('streetlight', FAINT, { dark: true }, 11) }} />Lamp dark</span>}
          {lighting && <span><span className="legend-dot" style={{ background: 'var(--app-warning-soft)', borderColor: 'var(--app-warning-soft)', opacity: 0.7 }} />Lit area</span>}
          {power && <span><span className="gg-sym" style={{ width: 14, borderTop: '2px solid var(--app-warning)' }} />Supply</span>}
          {power && network?.links.some((l) => !l.energised) && <span><span className="gg-sym" style={{ width: 14, borderTop: '2px dashed var(--app-text-faint)' }} />No supply</span>}
          {cameras && <span><span className="gg-sym" dangerouslySetInnerHTML={{ __html: symbol('camera', 'var(--app-info)', {}, 12) }} />CCTV{coverage ? ' + view' : ''}</span>}
          {dealers && <span><span className="legend-dot" style={{ background: 'var(--app-teal)' }} />Scrap dealer</span>}
          {route?.stops?.length > 0 && <span><span className="legend-dot" style={{ background: 'var(--app-accent)' }} />Patrol stop</span>}
        </div>
      )}
    </div>
  );
}
